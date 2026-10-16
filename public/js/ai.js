// Bot brains: target selection, needs (health/ammo/power-ups), A* navigation, steering,
// stuck recovery, ballistic aiming with target leading, and weapon choice by range.
import { WEAPONS } from './defs.js';
import { wrapAngle, clamp } from './math.js';

const DIFFICULTY = {
  easy: { aimErr: 0.11, react: 0.9, lead: 0.3, turretMul: 0.6, sense: 90, fireTol: 1.6, homing: 0.3 },
  normal: { aimErr: 0.045, react: 0.45, lead: 0.75, turretMul: 0.85, sense: 130, fireTol: 1.1, homing: 0.6 },
  hard: { aimErr: 0.015, react: 0.18, lead: 1.0, turretMul: 1.0, sense: 180, fireTol: 0.8, homing: 1.0 },
};

/** Preferred engagement distance per tank type — this is what makes bots play each style. */
const STYLE = {
  hornet: { range: 16, strafe: 1.0, flee: 0.3 },
  trooper: { range: 34, strafe: 0.6, flee: 0.3 },
  bulldog: { range: 6, strafe: 0.15, flee: 0.15 },
  thumper: { range: 75, strafe: 0.3, flee: 0.45 },
  longshot: { range: 95, strafe: 0.25, flee: 0.45 },
};

/** Solve launch pitch for speed v, gravity g, horizontal dist x and height diff y. high=true picks the lob arc. */
export function ballisticPitch(v, g, x, y, high = false) {
  if (g <= 0) return Math.atan2(y, x);
  const v2 = v * v;
  const disc = v2 * v2 - g * (g * x * x + 2 * y * v2);
  if (disc < 0) return high ? 0.8 : Math.PI / 4; // out of range: best effort
  const s = Math.sqrt(disc);
  return Math.atan((high ? v2 + s : v2 - s) / (g * x));
}

export class Bot {
  constructor(game, tank, difficulty) {
    this.g = game;
    this.t = tank;
    this.d = DIFFICULTY[difficulty] || DIFFICULTY.normal;
    this.style = STYLE[tank.def.id];
    this.target = null;
    this.targetSince = 0;
    this.path = null;
    this.pathGoal = null;
    this.pathT = 0;
    this.thinkT = Math.random() * 0.2;
    this.stuckT = 0;
    this.unstickT = 0;
    this.unstickTurn = 1;
    this.errYaw = 0; this.errPitch = 0; this.errT = 0;
    this.strafeDir = Math.random() < 0.5 ? 1 : -1;
    this.strafeT = 0;
    this.goal = null;
    this.goalKind = 'wander';
    this.wanderT = 0;
    this.ctrl = { throttle: 0, turn: 0, aimYaw: tank.yaw, aimPitch: 0.05, fire: false, weapon: null };
  }

  enemies() { return this.g.tanks.filter((o) => o !== this.t && o.alive && !o.eliminated); }

  pickTarget() {
    const t = this.t;
    let best = null, bestScore = 1e9;
    for (const e of this.enemies()) {
      const d = Math.hypot(e.x - t.x, e.z - t.z);
      if (e.power.ghost > 0 && d > 12) continue;
      if (d > this.d.sense && e !== t.lastHitBy) continue;
      const los = !this.g.world.segmentBlocked(t.x, t.y + 2, t.z, e.x, e.y + 1.5, e.z);
      let s = d - (los ? 35 : 0) - (1 - e.hp / e.maxHp) * 25;
      if (e === t.lastHitBy && t.lastHitT > this.g.time - 4) s -= 40;
      if (e === this.target) s -= 15; // hysteresis
      if (e.human) s -= 5;
      if (s < bestScore) { bestScore = s; best = e; }
    }
    if (best !== this.target) { this.target = best; this.targetSince = this.g.time; }
  }

  /** Choose where to drive: pickups when in need, otherwise toward/around the target. */
  chooseGoal() {
    const t = this.t, g = this.g;
    const hpFrac = t.hp / t.maxHp;
    const ammoFrac = t.weapons.reduce((a, w) => a + w.ammo / WEAPONS[w.id].maxAmmo, 0) / t.weapons.length;
    const near = (kind, maxD) => {
      let best = null, bd = maxD;
      for (const p of g.pickups) {
        if (!p.active || (kind && p.kind !== kind) || p.unreachable > g.time) continue;
        const d = Math.hypot(p.x - t.x, p.z - t.z);
        if (d < bd) { bd = d; best = p; }
      }
      return best;
    };
    let p = null;
    if (hpFrac < 0.45) p = near('health', 160);
    if (!p && ammoFrac < 0.25) p = near('ammo', 160);
    if (!p && !this.target) p = near('power', 120) || near('weapon', 120) || (hpFrac < 0.9 ? near('health', 80) : null);
    if (!p && this.target) {
      const pp = near('power', 22) || near('weapon', 18);
      if (pp) p = pp;
    }
    if (p) { this.goal = [p.x, p.z]; this.goalKind = 'pickup'; this.goalPickup = p; return; }
    this.goalPickup = null;
    const e = this.target;
    if (e) {
      const dx = t.x - e.x, dz = t.z - e.z, d = Math.hypot(dx, dz) || 1;
      const R = this.style.range;
      if (d > R + 12) { this.goal = [e.x, e.z]; this.goalKind = 'chase'; return; }
      // orbit / hold range: point on a ring around the target, rotated by strafe direction
      const a = Math.atan2(dz, dx) + this.strafeDir * this.style.strafe * 0.9;
      const rr = d < R - 8 ? R + 4 : R;
      this.goal = [e.x + Math.cos(a) * rr, e.z + Math.sin(a) * rr];
      this.goalKind = 'fight';
      return;
    }
    if (!this.goal || this.goalKind !== 'wander' || this.wanderT <= 0 || Math.hypot(this.goal[0] - t.x, this.goal[1] - t.z) < 8) {
      const spots = g.world.pickupSpots;
      const s = spots[Math.floor(Math.random() * spots.length)];
      this.goalPickup = null;
      this.goal = s ? [s.x, s.z] : [0, 0];
      this.goalKind = 'wander';
      this.wanderT = 12;
    }
  }

  chooseWeapon(dist, los) {
    const t = this.t;
    let best = null, bestScore = -1e9;
    for (const w of t.weapons) {
      if (w.ammo <= 0) continue;
      const W = WEAPONS[w.id];
      let s = 0;
      switch (W.kind) {
        case 'flame': s = dist < 14 ? 90 : -100; break;
        case 'bullet': s = dist < 60 ? 40 : dist < 100 ? 10 : -50; break;
        case 'shell': s = dist < 110 ? 55 : 15; break;
        case 'rocket': s = dist > 20 && dist < 90 ? (Math.hypot(this.target?.vx || 0, this.target?.vz || 0) > 7 ? 62 : 48) : 5; break;
        case 'lob': s = !los ? 70 : dist > 30 ? 45 : -60; break;
        case 'rail': s = dist > 25 ? 75 : 35; break;
        case 'mine': s = -200; break;
      }
      if (!los && W.kind !== 'lob') s -= 60;
      if (s > bestScore) { bestScore = s; best = w.id; }
    }
    return best;
  }

  update(dt) {
    const t = this.t, g = this.g, c = this.ctrl;
    if (!t.alive) { c.throttle = 0; c.turn = 0; c.fire = false; return c; }
    this.thinkT -= dt;
    this.wanderT -= dt;
    this.strafeT -= dt;
    if (this.strafeT <= 0) { this.strafeDir *= -1; this.strafeT = 3 + Math.random() * 4; }
    if (this.thinkT <= 0) {
      this.thinkT = 0.35;
      this.pickTarget();
      this.chooseGoal();
    }

    // ---- navigation ----
    const goal = this.goal;
    let steerX = 0, steerZ = 0, wantReverse = false;
    if (goal) {
      this.pathT -= dt;
      const goalMoved = !this.pathGoal || Math.hypot(this.pathGoal[0] - goal[0], this.pathGoal[1] - goal[1]) > 8;
      if (!this.path || this.pathT <= 0 || goalMoved) {
        if (g.world.navLineClear(t.x, t.z, goal[0], goal[1])) this.path = [goal];
        else {
          this.path = g.world.findPath(t.x, t.z, goal[0], goal[1], 12000);
          if (!this.path) {
            // unreachable goal: remember it and choose something else instead of ramming the shoreline
            if (this.goalPickup) this.goalPickup.unreachable = g.time + 20;
            this.goal = null; this.wanderT = 0; this.goalKind = 'wander';
            this.chooseGoal();
            this.path = [this.goal || [t.x, t.z]];
          }
        }
        this.pathGoal = goal.slice();
        this.pathT = 1.5 + Math.random() * 0.5;
      }
      while (this.path.length > 1 && Math.hypot(this.path[0][0] - t.x, this.path[0][1] - t.z) < 5) this.path.shift();
      const wp = this.path[0];
      steerX = wp[0] - t.x; steerZ = wp[1] - t.z;
      const dist = Math.hypot(steerX, steerZ);
      if (this.goalKind === 'fight' && dist < 3) { steerX = 0; steerZ = 0; }
      // long-range tanks back away to keep their preferred distance
      if (this.target && this.style.flee > 0.3) {
        const dT = Math.hypot(this.target.x - t.x, this.target.z - t.z);
        if (dT < this.style.range * 0.65) {
          wantReverse = true;
          steerX = t.x - this.target.x; steerZ = t.z - this.target.z;
        }
      }
      // brawlers charge in for the ram once close
      if (this.target && t.def.id === 'bulldog') {
        const dT = Math.hypot(this.target.x - t.x, this.target.z - t.z);
        if (dT < 16 && g.world.navLineClear(t.x, t.z, this.target.x, this.target.z)) {
          steerX = this.target.x - t.x; steerZ = this.target.z - t.z;
          this.charging = true;
        } else this.charging = false;
      }
    }

    // obstacle avoidance feelers
    const fwdYaw = t.yaw;
    const avoid = this.feel(fwdYaw);

    let throttle = 0, turn = 0;
    if (steerX || steerZ) {
      let desired = Math.atan2(steerX, steerZ);
      let reverse = false;
      if (wantReverse) {
        const back = wrapAngle(desired + Math.PI - fwdYaw);
        // steerX/Z already points away from the threat; reverse if that is roughly behind us
        const away = wrapAngle(desired - fwdYaw);
        if (Math.abs(away) > 1.9) { reverse = true; desired = desired + Math.PI; }
        else if (Math.abs(back) < 1.2) { reverse = true; desired = desired + Math.PI; }
      }
      const diff = wrapAngle(desired - fwdYaw);
      turn = clamp(diff * 2.2, -1, 1) + avoid;
      throttle = reverse ? -1 : Math.abs(diff) > 1.3 ? 0.15 : Math.abs(diff) > 0.6 ? 0.6 : 1;
      if (this.goalKind === 'fight' && Math.hypot(steerX, steerZ) < 6 && !this.charging) throttle *= 0.4;
    }
    turn = clamp(turn, -1, 1);

    // stuck detection & recovery
    if (Math.abs(throttle) > 0.4 && Math.abs(t.speed) < 1.2) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt);
    if (this.stuckT > 1.0) { this.unstickT = 0.9 + Math.random() * 0.6; this.unstickTurn = Math.random() < 0.5 ? 1 : -1; this.stuckT = 0; this.path = null; }
    if (this.unstickT > 0) {
      this.unstickT -= dt;
      throttle = -Math.sign(throttle || 1);
      turn = this.unstickTurn;
    }
    c.throttle = throttle;
    c.turn = turn;

    // ---- aiming & firing ----
    c.fire = false;
    const e = this.target;
    this.errT -= dt;
    if (this.errT <= 0) {
      this.errT = 0.4 + Math.random() * 0.6;
      this.errYaw = (Math.random() - 0.5) * 2 * this.d.aimErr;
      this.errPitch = (Math.random() - 0.5) * this.d.aimErr * 0.5;
    }
    if (e) {
      const dx = e.x - t.x, dz = e.z - t.z, dist = Math.hypot(dx, dz);
      const los = !g.world.segmentBlocked(t.x, t.y + 2, t.z, e.x, e.y + 1.4, e.z);
      if (this.thinkT === 0.35 || !c.weapon) c.weapon = this.chooseWeapon(dist, los) || t.weapons[0].id;
      const W = WEAPONS[c.weapon];
      const v = W.speed || 200;
      let tFlight = dist / v;
      if (W.kind === 'lob' || W.kind === 'shell') {
        // flight time from the solved launch angle (a high mortar arc is slow!)
        const p0 = ballisticPitch(v, W.gravity, dist, 0, W.kind === 'lob');
        tFlight = dist / (v * Math.max(0.15, Math.cos(p0)));
      }
      const lead = W.kind === 'rail' || W.kind === 'rocket' ? 0 : this.d.lead;
      const px = e.x + e.vx * tFlight * lead, pz = e.z + e.vz * tFlight * lead;
      const pdx = px - t.x, pdz = pz - t.z, pd = Math.hypot(pdx, pdz);
      const muzzleY = t.y + 1.8;
      const ty = g.world.heightAt(px, pz) + 1.2;
      c.aimYaw = Math.atan2(pdx, pdz) + this.errYaw;
      let pitch;
      if (W.kind === 'lob') {
        // prefer the high arc (drops over cover); fall back to the flat arc when too close for it
        pitch = ballisticPitch(v, W.gravity, pd, ty - muzzleY, true);
        if (pitch > t.def.pitchMax) pitch = ballisticPitch(v, W.gravity, pd, ty - muzzleY, false);
      }
      else if (W.kind === 'shell') pitch = ballisticPitch(v, W.gravity, pd, ty - muzzleY, false);
      else pitch = Math.atan2(ty - muzzleY, pd);
      c.aimPitch = clamp(pitch + this.errPitch, t.def.pitchMin, t.def.pitchMax);
      const yawErr = Math.abs(wrapAngle(t.turretYaw - c.aimYaw));
      const tol = Math.max(0.03, Math.atan2(2.2, dist)) * this.d.fireTol;
      const ready = g.time - this.targetSince > this.d.react;
      const range = W.range || (W.kind === 'lob' ? 200 : 160);
      if (ready && yawErr < tol + Math.abs(this.errYaw) && dist < range && (los || W.kind === 'lob') && e.alive) c.fire = true;
      if (W.kind === 'lob' && dist < 25) c.fire = false;
      // mines: drop them when being chased
      const mine = t.weapons.find((w) => w.id === 'mines' && w.ammo > 0);
      if (mine && dist < 22) {
        const behind = Math.abs(wrapAngle(Math.atan2(dx, dz) - (t.yaw + Math.PI))) < 0.8;
        if (behind && Math.random() < dt * 1.5) c.dropMine = true;
      }
    } else {
      // scan ahead lazily when idle
      c.aimYaw = t.yaw + Math.sin(g.time * 0.5 + t.id) * 0.6;
      c.aimPitch = clamp(0.05, t.def.pitchMin, t.def.pitchMax);
      if (!c.weapon) c.weapon = t.weapons[0].id;
    }
    return c;
  }

  /** Probe ahead for obstacles / water and return a turn correction. */
  feel(yaw) {
    const t = this.t, w = this.g.world;
    const L = 7 + Math.abs(t.speed) * 0.35;
    const probe = (a) => {
      const x = t.x + Math.sin(yaw + a) * L, z = t.z + Math.cos(yaw + a) * L;
      if (w.isWater(x, z) || !w.inBounds(x, z, 2)) return 1;
      let hit = 0;
      w.query(x, z, t.radius * 0.9, (o) => { if (!o.soft) { hit = 1; return false; } });
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
