// Bot brains: target selection, needs (health/ammo/power-ups), A* navigation, steering, stuck recovery,
// ballistic aiming with target leading, weapon choice by range, seeker locks, air strikes and smoke.
// Bots drive their tank through the same input record network players send.
import { WEAPONS, shotSpeed, shotGravity } from './defs.js';
import { wrapAngle, clamp } from './math.js';
import { crossesLogs } from './world.js';

const DIFFICULTY = {
  easy: { aimErr: 0.11, react: 0.9, lead: 0.3, turretMul: 0.6, sense: 100, fireTol: 1.6, lockMul: 2.2, smoke: 0.3 },
  normal: { aimErr: 0.045, react: 0.45, lead: 0.75, turretMul: 0.85, sense: 140, fireTol: 1.1, lockMul: 1.4, smoke: 0.7 },
  hard: { aimErr: 0.015, react: 0.18, lead: 1.0, turretMul: 1.0, sense: 190, fireTol: 0.8, lockMul: 1.0, smoke: 1 },
};

/**
 * Bot skill 1-5, chosen in the lobby (or --skill). 5 is the difficulty preset unchanged; each step
 * down scales it by k = (5 - skill) / 4, so 1 is k = 1: slower reactions and decisions, worse aim and
 * leading, a slower turret, shorter awareness, sloppier trigger discipline and poorer use of pickups.
 */
export const SKILL_MAX = 5;
export function botParams(difficulty, skill = SKILL_MAX) {
  const base = DIFFICULTY[difficulty] || DIFFICULTY.normal;
  const s = Math.max(1, Math.min(SKILL_MAX, Math.round(Number(skill)) || SKILL_MAX));
  const k = (SKILL_MAX - s) / (SKILL_MAX - 1);
  if (k === 0) return { ...base, think: 0.35, seek: 1, stuck: 1.0 }; // skill 5: exactly today's bots
  return {
    aimErr: base.aimErr * (1 + 3 * k), // normal: 0.045 rad -> 0.18 rad
    react: base.react + 1.2 * k, // seconds before firing on a new target
    lead: base.lead * (1 - 0.7 * k), // how well they lead moving targets
    turretMul: base.turretMul * (1 - 0.4 * k),
    sense: base.sense * (1 - 0.4 * k), // how far away they notice enemies
    fireTol: base.fireTol * (1 + 0.8 * k), // fire before the gun is on target (wastes shots)
    lockMul: base.lockMul * (1 + 1.5 * k), // slower seeker locks
    smoke: base.smoke * (1 - 0.8 * k), // less likely to pop smoke when hurt
    think: 0.35 * (1 + 2 * k), // seconds between re-picking targets and goals
    seek: 1 - 0.5 * k, // how far they look for health / ammo / power-ups
    stuck: 1.0 + 1.5 * k, // slower to notice being stuck
  };
}

/** Preferred engagement distance per vehicle — this is what makes bots play each style. */
const STYLE = {
  scout: { range: 14, strafe: 1.0, flee: 0.2 },
  standard: { range: 40, strafe: 0.6, flee: 0.25 },
  artillery: { range: 85, strafe: 0.3, flee: 0.6 },
  superheavy: { range: 8, strafe: 0.15, flee: 0.1 },
};

/** Launch pitch for speed v, gravity g, horizontal dist x and height diff y. high=true picks the lob arc. */
export function ballisticPitch(v, g, x, y, high = false) {
  if (g <= 0) return Math.atan2(y, x);
  const v2 = v * v;
  const disc = v2 * v2 - g * (g * x * x + 2 * y * v2);
  if (disc < 0) return high ? 0.8 : Math.PI / 4;
  const s = Math.sqrt(disc);
  return Math.atan((high ? v2 + s : v2 - s) / (g * x));
}

/** Launch speed so a projectile fired at angle `pitch` lands `dist` away on level ground. */
export function seekerSpeed(dist, g, pitch) {
  return Math.sqrt((g * dist) / Math.max(0.05, Math.sin(2 * pitch)));
}

export class Bot {
  constructor(sim, tank, difficulty, skill = SKILL_MAX) {
    this.g = sim;
    this.t = tank;
    this.d = botParams(difficulty, skill);
    this.target = null;
    this.targetSince = 0;
    this.path = null;
    this.pathGoal = null;
    this.pathT = 0;
    this.thinkT = Math.random() * 0.3;
    this.stuckT = 0;
    this.unstickT = 0;
    this.unstickTurn = 1;
    this.errYaw = 0; this.errPitch = 0; this.errT = 0;
    this.strafeDir = Math.random() < 0.5 ? 1 : -1;
    this.strafeT = 0;
    this.goal = null;
    this.goalKind = 'wander';
    this.wanderT = 0;
    this.lockT = 0;
    this.smokeT = 0;
    this.weapon = null;
  }

  get style() { return STYLE[this.t.def.id]; }

  pickTarget() {
    const t = this.t, g = this.g;
    let best = null, bestScore = 1e9;
    for (const e of g.tanks) {
      if (e === t || !e.alive || e.eliminated) continue;
      const d = Math.hypot(e.x - t.x, e.z - t.z);
      if (e.power.ghost > 0 && d > 12) continue;
      if (e.invulnT > 0.3) continue;
      if (d > this.d.sense && e !== t.lastHitBy) continue;
      const los = g.los(t, e);
      let s = d - (los ? 35 : 0) - (1 - e.hp / e.maxHp) * 25;
      if (e === t.lastHitBy && t.lastHitT > g.time - 4) s -= 40;
      if (e === this.target) s -= 15;
      if (e.human) s -= 5;
      if (t.def.id === 'superheavy') s += d * 0.8;
      if (s < bestScore) { bestScore = s; best = e; }
    }
    if (best !== this.target) { this.target = best; this.targetSince = g.time; this.lockT = 0; }
  }

  chooseGoal() {
    const t = this.t, g = this.g;
    const hpFrac = t.hp / t.maxHp;
    const ammoFrac = t.weapons.reduce((a, w) => a + w.ammo / WEAPONS[w.id].maxAmmo, 0) / t.weapons.length;
    const near = (kind, maxD) => {
      let best = null, bd = maxD * this.d.seek;
      for (const p of g.pickups) {
        if (!p.active || (kind && p.kind !== kind) || p.unreachable > g.time) continue;
        const d = Math.hypot(p.x - t.x, p.z - t.z);
        if (d < bd) { bd = d; best = p; }
      }
      return best;
    };
    // flee an incoming air strike first
    for (const s of g.strikes) {
      if (s.t > -0.5 && Math.hypot(s.x - t.x, s.z - t.z) < s.r + 10) {
        const dx = t.x - s.x, dz = t.z - s.z, dl = Math.hypot(dx, dz) || 1;
        this.goal = [s.x + (dx / dl) * (s.r + 18), s.z + (dz / dl) * (s.r + 18)];
        this.goalKind = 'escape';
        this.goalPickup = null;
        return;
      }
    }
    let p = null;
    if (hpFrac < 0.45) p = near('health', 160);
    if (!p && ammoFrac < 0.25) p = near('ammo', 160);
    if (!p && !this.target) p = near('power', 120) || near('weapon', 120) || (hpFrac < 0.9 ? near('health', 80) : null);
    if (!p && this.target) p = near('power', 22) || near('weapon', 18);
    if (p) { this.goal = [p.x, p.z]; this.goalKind = 'pickup'; this.goalPickup = p; return; }
    this.goalPickup = null;
    const e = this.target;
    if (e) {
      const dx = t.x - e.x, dz = t.z - e.z, d = Math.hypot(dx, dz) || 1;
      const R = this.style.range;
      if (d > R + 12) { this.goal = [e.x, e.z]; this.goalKind = 'chase'; return; }
      const a = Math.atan2(dz, dx) + this.strafeDir * this.style.strafe * 0.9;
      const rr = d < R - 8 ? R + 4 : R;
      this.goal = [e.x + Math.cos(a) * rr, e.z + Math.sin(a) * rr];
      this.goalKind = 'fight';
      return;
    }
    if (!this.goal || this.goalKind !== 'wander' || this.wanderT <= 0 || Math.hypot(this.goal[0] - t.x, this.goal[1] - t.z) < 8) {
      const spots = g.world.pickupSpots;
      const s = spots[Math.floor(Math.random() * spots.length)];
      this.goal = s ? [s.x, s.z] : [0, 0];
      this.goalKind = 'wander';
      this.wanderT = 12;
    }
  }

  chooseWeapon(dist, los, e) {
    const t = this.t;
    let best = null, bestScore = -1e9;
    for (const w of t.weapons) {
      if (w.ammo <= 0) continue;
      let s = -100;
      switch (w.id) {
        case 'flame': s = dist < 18 ? (t.heat < 2.2 ? 92 : -40) : -100; break;
        case 'rapid': s = dist < 70 ? 60 : dist < 110 ? 30 : -50; break;
        case 'standard': s = dist < 130 ? 50 : 20; break;
        case 'highvel': s = dist > 25 && los && e.hp > 30 ? 66 : -20; break;
        case 'seeker': s = dist > 25 && dist < 190 && los ? 64 : 15; break; // only worth it with a lock
        case 'cluster': s = dist > 30 && dist < 150 ? 58 : -40; break;
        case 'massive': s = dist > 45 && dist < 150 && e.hp > 60 ? 100 : -100; break;
        case 'strike': s = t.strikeCd <= 0 && dist > 35 && dist < 200 && Math.hypot(e.vx, e.vz) < 9 ? 95 : -200; break;
      }
      if (!los && !['cluster', 'strike', 'standard'].includes(w.id)) s -= 60;
      if (!los && w.id === 'standard' && t.def.pitchMax < 1) s -= 60;
      if (s > bestScore) { bestScore = s; best = w.id; }
    }
    return best;
  }

  update(dt) {
    const t = this.t, g = this.g, c = t.input;
    if (!t.alive) { c.throttle = 0; c.turn = 0; c.fire = false; return; }
    this.thinkT -= dt; this.wanderT -= dt; this.strafeT -= dt;
    if (this.strafeT <= 0) { this.strafeDir *= -1; this.strafeT = 3 + Math.random() * 4; }
    let thinking = false;
    if (this.thinkT <= 0) { this.thinkT = this.d.think; thinking = true; this.pickTarget(); this.chooseGoal(); }

    // ---- navigation ----
    const goal = this.goal;
    let steerX = 0, steerZ = 0, wantReverse = false;
    this.charging = false;
    if (goal) {
      this.pathT -= dt;
      const goalMoved = !this.pathGoal || Math.hypot(this.pathGoal[0] - goal[0], this.pathGoal[1] - goal[1]) > 8;
      if (!this.path || this.pathT <= 0 || goalMoved) {
        const scout = !crossesLogs(t.def);
        if (g.world.navLineClear(t.x, t.z, goal[0], goal[1], scout)) this.path = [goal];
        else {
          this.path = g.world.findPath(t.x, t.z, goal[0], goal[1], 12000, scout);
          if (!this.path) {
            if (this.goalPickup) this.goalPickup.unreachable = g.time + 20;
            this.goal = null; this.wanderT = 0; this.goalKind = 'wander';
            this.chooseGoal();
            this.path = [this.goal || [t.x, t.z]];
          }
        }
        this.pathGoal = (this.goal || goal).slice();
        this.pathT = 1.5 + Math.random() * 0.5;
      }
      while (this.path.length > 1 && Math.hypot(this.path[0][0] - t.x, this.path[0][1] - t.z) < 5) this.path.shift();
      const wp = this.path[0];
      steerX = wp[0] - t.x; steerZ = wp[1] - t.z;
      if (this.goalKind === 'fight' && Math.hypot(steerX, steerZ) < 3) { steerX = 0; steerZ = 0; }
      if (this.target && this.style.flee > 0.3 && this.goalKind !== 'escape') {
        const dT = Math.hypot(this.target.x - t.x, this.target.z - t.z);
        if (dT < this.style.range * 0.8) { wantReverse = true; steerX = t.x - this.target.x; steerZ = t.z - this.target.z; }
      }
      if (this.target && t.def.id === 'superheavy' && this.goalKind !== 'escape') {
        const dT = Math.hypot(this.target.x - t.x, this.target.z - t.z);
        if (dT < 16 && g.world.navLineClear(t.x, t.z, this.target.x, this.target.z)) { steerX = this.target.x - t.x; steerZ = this.target.z - t.z; this.charging = true; }
      }
    }
    const avoid = this.feel(t.yaw);
    let throttle = 0, turn = 0;
    if (steerX || steerZ) {
      let desired = Math.atan2(steerX, steerZ);
      let reverse = false;
      if (wantReverse && Math.abs(wrapAngle(desired - t.yaw)) > 1.9) { reverse = true; desired += Math.PI; }
      const diff = wrapAngle(desired - t.yaw);
      turn = clamp(diff * 2.2, -1, 1) + avoid;
      throttle = reverse ? -1 : Math.abs(diff) > 1.3 ? 0.15 : Math.abs(diff) > 0.6 ? 0.6 : 1;
      if (this.goalKind === 'fight' && Math.hypot(steerX, steerZ) < 6 && !this.charging) throttle *= 0.4;
    }
    turn = clamp(turn, -1, 1);
    if (Math.abs(throttle) > 0.4 && Math.abs(t.speed) < 1.2) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt);
    if (this.stuckT > this.d.stuck) { this.unstickT = 0.9 + Math.random() * 0.6; this.unstickTurn = Math.random() < 0.5 ? 1 : -1; this.stuckT = 0; this.path = null; }
    if (this.unstickT > 0) { this.unstickT -= dt; throttle = -Math.sign(throttle || 1); turn = this.unstickTurn; }
    c.throttle = throttle;
    c.turn = turn;

    // ---- smoke when hurt and under fire ----
    this.smokeT -= dt;
    if (t.smokeAmmo > 0 && this.smokeT <= 0 && t.hp / t.maxHp < 0.4 && g.time - t.lastHitT < 1.5 && Math.random() < this.d.smoke) {
      c.smoke = (c.smoke || 0) + 1;
      this.smokeT = 8;
    }

    // ---- aiming & firing ----
    c.fire = false;
    this.errT -= dt;
    if (this.errT <= 0) {
      this.errT = 0.4 + Math.random() * 0.6;
      this.errYaw = (Math.random() - 0.5) * 2 * this.d.aimErr;
      this.errPitch = (Math.random() - 0.5) * this.d.aimErr * 0.5;
    }
    const e = this.target;
    if (!e) {
      c.aimYaw = t.yaw + Math.sin(g.time * 0.5 + t.id) * 0.6;
      c.aimPitch = clamp(0.05, t.def.pitchMin, t.def.pitchMax);
      c.lock = -1;
      return;
    }
    const dx = e.x - t.x, dz = e.z - t.z, dist = Math.hypot(dx, dz);
    const los = g.los(t, e);
    if (thinking || !this.weapon || !t.weapons.find((w) => w.id === this.weapon && w.ammo > 0)) this.weapon = this.chooseWeapon(dist, los, e) || t.weapons[0].id;
    c.weapon = this.weapon;
    const W = WEAPONS[this.weapon];
    const v = shotSpeed(t.def, this.weapon), G = shotGravity(t.def, this.weapon);
    if (this.arcT === undefined || g.time > this.arcT) { this.highArc = !los; this.arcT = g.time + 2.5; }
    const lobbed = W.kind === 'seeker' || W.kind === 'strike';
    const highArc = (W.kind === 'shell' || W.kind === 'cluster') && this.highArc && t.def.pitchMax > 1;
    let tFlight = dist / v;
    if (lobbed) tFlight = (2 * seekerSpeed(dist, G, W.launchPitch) * Math.sin(W.launchPitch)) / G;
    else if (G) { const p0 = ballisticPitch(v, G, dist, 0, highArc); tFlight = dist / (v * Math.max(0.15, Math.cos(p0))); }
    const hd = Math.atan2(e.vx, e.vz);
    const turnRate = this.prevHd !== undefined && this.prevTarget === e ? Math.abs(wrapAngle(hd - this.prevHd)) / Math.max(dt, 1e-3) : 0;
    this.prevHd = hd; this.prevTarget = e;
    this.turnEst = (this.turnEst || 0) * 0.9 + turnRate * 0.1;
    let lead = this.d.lead * clamp(1 - this.turnEst * tFlight * 0.35, 0.2, 1);
    if (W.kind === 'strike') lead = 0; // the zone is big; aim where they are
    let lx = e.vx * tFlight * lead, lz = e.vz * tFlight * lead;
    const ll = Math.hypot(lx, lz), cap = tFlight > 2.5 ? 14 : 60;
    if (ll > cap) { lx *= cap / ll; lz *= cap / ll; }
    const px = e.x + lx, pz = e.z + lz, pd = Math.hypot(px - t.x, pz - t.z);
    const muzzleY = t.muzzle[1];
    const ty = g.world.heightAt(px, pz) + 1.2;
    c.aimYaw = Math.atan2(px - t.x, pz - t.z) + this.errYaw;
    c.aimDist = pd * (1 + this.errPitch);
    let pitch;
    if (lobbed) pitch = W.launchPitch;
    else if (G) {
      pitch = ballisticPitch(v, G, pd, ty - muzzleY, highArc);
      if (pitch > t.def.pitchMax || pitch < t.def.pitchMin) pitch = ballisticPitch(v, G, pd, ty - muzzleY, !highArc);
    } else pitch = Math.atan2(ty - muzzleY, pd);
    c.aimPitch = clamp(pitch + (lobbed ? 0 : this.errPitch), t.def.pitchMin, t.def.pitchMax);
    // seeker lock: like a commander keeping the target in the reticle
    const yawErr = Math.abs(wrapAngle(t.turretYaw - c.aimYaw));
    if (W.kind === 'seeker' && los && yawErr < 0.15 && g.lockValid(t, e, 0.3)) this.lockT += dt; else this.lockT = Math.max(0, this.lockT - dt);
    c.lock = W.kind === 'seeker' && this.lockT >= W.lockTime * this.d.lockMul ? e.id : -1;
    const tol = Math.max(0.03, Math.atan2(2.2, dist)) * this.d.fireTol * (W.kind === 'strike' ? 4 : 1);
    const ready = g.time - this.targetSince > this.d.react;
    const range = W.range || (G ? ((v * v) / G) * 0.95 : 160);
    const pitchOk = lobbed || Math.abs(t.pitch - c.aimPitch) < (G > 8 ? 0.025 : 0.08);
    const canHit = los || lobbed || W.kind === 'cluster' || highArc;
    if (ready && pitchOk && yawErr < tol + Math.abs(this.errYaw) && dist < range && canHit && e.alive) c.fire = true;
    if (W.kind === 'seeker' && los && c.lock < 0 && this.lockT > 0) c.fire = false; // a lock is coming: wait for it
    if ((W.kind === 'cluster' || highArc || W.id === 'massive') && dist < 28) c.fire = false;
    if (highArc && Math.hypot(e.vx, e.vz) > 5) c.fire = false;
    if (W.kind === 'flame' && t.heat > 3) c.fire = false; // bots respect the fuel risk (mostly)
    // rapid fire in bursts: let the spread settle before the next burst
    if (W.kind === 'bullet') {
      if (t.bloom > 0.035 + this.d.aimErr * 0.6) this.burstRest = true;
      if (this.burstRest && t.bloom < 0.012) this.burstRest = false;
      if (this.burstRest) c.fire = false;
    }
  }

  /** Probe ahead for obstacles / water and return a turn correction. */
  feel(yaw) {
    const t = this.t, w = this.g.world;
    const L = 7 + Math.abs(t.speed) * 0.35;
    const probe = (a) => {
      const x = t.x + Math.sin(yaw + a) * L, z = t.z + Math.cos(yaw + a) * L;
      if (w.isWater(x, z) || !w.inBounds(x, z, 2)) return 1;
      let hit = 0;
      const logs = crossesLogs(t.def);
      w.query(x, z, t.radius * 0.9, (o) => { if (!o.soft && !(o.log && logs)) { hit = 1; return false; } });
      return hit;
    };
    const l = probe(0.45), r = probe(-0.45), c = probe(0);
    let turn = 0;
    if (l && !r) turn -= 0.9;
    else if (r && !l) turn += 0.9;
    else if (c) turn += this.strafeDir * 0.9;
    return turn * (Math.sign(t.speed) || 1);
  }
}
