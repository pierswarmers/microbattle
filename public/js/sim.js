// Authoritative game simulation. Runs on the server (and headless in the balance harness):
// tanks, physics, weapons, pickups, air strikes, smoke, bots and match rules. No rendering, audio or input.
// Everything clients need to show effects is emitted as events, drained by the server each snapshot.
import { World, WATER_LEVEL } from './world.js';
import { Bot, ballisticPitch, seekerSpeed } from './ai.js';
import {
  TANK_TYPES, TANK_ORDER, TANK_GEOM, WEAPONS, POWERUPS, POWERUP_ORDER, PICKUP_KINDS, CRATE_WEAPONS,
  PLAYER_COLORS, SMOKE, FLAME_HEAT, WEAPON_ORDER, pickWeighted, shotSpeed, shotGravity,
} from './defs.js';
import { m4, clamp, lerp, wrapAngle, approachAngle, makeRng, alignToNormal, dirFromYawPitch } from './math.js';

export const DT = 1 / 60;
const BOT_NAMES = ['Sarge', 'Tinker', 'Rusty', 'Boomer', 'Dozer', 'Pip', 'Gizmo', 'Nugget', 'Sprocket', 'Chomp'];

const NULL_MESH = { add() {}, clear() {} };
const NULL_TANK = { hull: NULL_MESH, turret: NULL_MESH, barrel: NULL_MESH };
/** Stand-in for the mesh set so the world can be generated without WebGL. */
export const NULL_MODELS = new Proxy({}, { get: (_, k) => (k === 'tanks' ? new Proxy({}, { get: () => NULL_TANK }) : NULL_MESH) });

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

export class Sim {
  constructor(cfg, world = null) {
    this.cfg = cfg;
    this.rng = makeRng(cfg.seed);
    this.world = world || new World(null, NULL_MODELS, cfg);
    this.time = 0;
    this.state = 'lobby';
    this.countdown = 3.5;
    this.matchTime = 0;
    this.tanks = [];
    this.bots = [];
    this.projectiles = [];
    this.pickups = [];
    this.drops = [];
    this.strikes = [];
    this.smokes = [];
    this.events = [];
    this.timers = [];
    this.nextId = 1;
    this.winner = null;
    this.firstBlood = false;
    this.dropT = cfg.airdrop;
    this.m = m4.create();
    this.initPickups();
  }

  emit(e, data = {}) { data.e = e; this.events.push(data); }
  drainEvents() { const ev = this.events; this.events = []; return ev; }
  later(delay, fn) { this.timers.push({ t: this.time + delay, fn }); }
  tankById(id) { return this.tanks.find((t) => t.id === id); }

  // ---------------- match setup ----------------
  /** entries: [{slot, human, type, name}] for humans; bots fill the remaining seats. */
  startMatch(entries) {
    const cfg = this.cfg;
    this.tanks = [];
    this.bots = [];
    const humans = entries.filter((e) => e.human);
    let botCount = cfg.bots === 'auto' ? 4 - humans.length : Math.min(cfg.bots, 4 - humans.length);
    const used = new Set(humans.map((h) => h.slot));
    const names = new Set();
    const order = humans.map((h) => ({ ...h }));
    for (let i = 0; i < botCount; i++) {
      const slot = [0, 1, 2, 3].find((k) => !used.has(k));
      if (slot === undefined) break;
      used.add(slot);
      let name;
      do name = BOT_NAMES[Math.floor(this.rng() * BOT_NAMES.length)]; while (names.has(name));
      names.add(name);
      const type = cfg.botTanks[i] || TANK_ORDER[Math.floor(this.rng() * TANK_ORDER.length)];
      order.push({ slot, human: false, type, name });
    }
    order.sort((a, b) => a.slot - b.slot);
    for (const o of order) {
      const t = this.makeTank(o.type, o.slot, o.human, o.name);
      this.tanks.push(t);
      if (!o.human) this.bots.push(new Bot(this, t, cfg.difficulty));
    }
    for (const t of this.tanks) this.spawnTank(t, true);
    this.state = 'countdown';
    this.countdown = 3.5;
    this.lastCount = 4;
    this.matchTime = 0;
  }

  makeTank(typeId, slot, human, name) {
    const def = TANK_TYPES[typeId];
    return {
      id: slot, slot, human, name, def, geom: TANK_GEOM[typeId], color: PLAYER_COLORS[slot].rgb, css: PLAYER_COLORS[slot].css,
      x: 0, y: 0, z: 0, yaw: 0, speed: 0, vx: 0, vz: 0, kx: 0, kz: 0, turretYaw: 0, pitch: 0.05,
      hp: def.hp, maxHp: def.hp, alive: false, respawnT: 0, invulnT: 0, eliminated: false,
      weapons: [], wi: 0, cooldown: 0, strikeCd: 0, bloom: 0, heat: 0, smokeAmmo: def.smoke, smokeCd: 0, smokeSeq: 0,
      burnT: 0, burnBy: null, burnDps: 8,
      power: { speed: 0, shield: 0, damage: 0, rapid: 0, ghost: 0 }, shieldHp: 0,
      kills: 0, deaths: 0, score: 0, streak: 0, lastKillT: -10, lives: this.cfg.lives,
      lastHitBy: null, lastHitT: -10, n: [0, 1, 0], radius: def.radius, scale: def.scale, ramT: 0,
      hullM: m4.create(), turretM: m4.create(), barrelM: m4.create(), muzzle: [0, 0, 0], dir: [0, 0, 1],
      input: { throttle: 0, turn: 0, aimYaw: 0, aimPitch: 0.05, aimDist: 60, fire: false, weapon: null, lock: -1, smoke: 0 },
      stats: { shots: 0, hits: 0, dmg: 0, pickups: 0, byWeapon: {} }, nextType: null,
    };
  }

  setType(t, typeId) {
    const def = TANK_TYPES[typeId];
    t.def = def; t.geom = TANK_GEOM[typeId]; t.maxHp = def.hp; t.radius = def.radius; t.scale = def.scale;
  }

  spawnTank(t, initial = false) {
    if (t.nextType) { this.setType(t, t.nextType); t.nextType = null; }
    const sp = this.world.spawns;
    let best = sp[t.slot % sp.length];
    if (!initial) {
      let bd = -1;
      for (const s of sp) {
        let md = 1e9;
        for (const o of this.tanks) if (o !== t && o.alive) md = Math.min(md, Math.hypot(o.x - s.x, o.z - s.z));
        if (md > bd) { bd = md; best = s; }
      }
    }
    const j = initial ? 0 : 6;
    t.x = best.x + (this.rng() - 0.5) * j;
    t.z = best.z + (this.rng() - 0.5) * j;
    t.y = this.world.heightAt(t.x, t.z);
    t.yaw = Math.atan2(-t.x, -t.z);
    t.turretYaw = t.yaw;
    t.input.aimYaw = t.yaw;
    t.speed = 0; t.vx = t.vz = t.kx = t.kz = 0;
    t.hp = t.maxHp;
    t.alive = true;
    t.invulnT = initial ? 0 : 2.5;
    t.burnT = 0; t.heat = 0; t.bloom = 0; t.strikeCd = 0;
    const full = initial || this.matchTime < 5;
    t.weapons = t.def.weapons.map((id) => ({ id, ammo: Math.ceil((WEAPONS[id].start + ((t.def.bonus || {})[id] || 0)) * (full ? 1 : 0.75)) }));
    if (this.cfg.debug && t.human) t.weapons = WEAPON_ORDER.map((id) => ({ id, ammo: WEAPONS[id].maxAmmo })); // --debug: try every weapon
    t.wi = 0;
    t.smokeAmmo = t.def.smoke;
    t.pitch = t.input.aimPitch = clamp(t.def.id === 'artillery' ? 0.35 : 0.04, t.def.pitchMin, t.def.pitchMax);
    for (const k in t.power) t.power[k] = 0;
    t.shieldHp = 0;
    this.world.normalAt(t.x, t.z, t.n);
    this.updateMatrices(t);
    if (!initial) this.emit('respawn', { id: t.id, x: r1(t.x), y: r1(t.y), z: r1(t.z) });
  }

  /** A network player takes over a seat (replacing the bot there, or a fresh tank mid-match). */
  humanJoin(slot, name, type) {
    let t = this.tankById(slot);
    if (!t) {
      t = this.makeTank(type, slot, true, name);
      this.tanks.push(t);
      this.tanks.sort((a, b) => a.slot - b.slot);
      this.spawnTank(t);
    } else {
      const wasBot = !t.human;
      this.bots = this.bots.filter((b) => b.t !== t);
      t.human = true; t.name = name;
      t.input = { ...t.input, throttle: 0, turn: 0, fire: false, lock: -1, aimYaw: t.turretYaw, aimPitch: t.pitch };
      if (wasBot && t.def.id !== type) {
        // the player's vehicle replaces the bot's in place: same spot, same health fraction, fresh loadout
        const frac = t.alive ? t.hp / t.maxHp : 1;
        this.setType(t, type);
        t.hp = t.maxHp * frac;
        t.weapons = t.def.weapons.map((id) => ({ id, ammo: Math.ceil(WEAPONS[id].start + ((t.def.bonus || {})[id] || 0)) }));
        t.wi = 0; t.smokeAmmo = t.def.smoke;
        if (this.cfg.debug) t.weapons = WEAPON_ORDER.map((id) => ({ id, ammo: WEAPONS[id].maxAmmo }));
        t.pitch = clamp(t.pitch, t.def.pitchMin, t.def.pitchMax);
        this.updateMatrices(t);
      } else if (!wasBot && t.def.id !== type) { if (t.alive) t.nextType = type; else this.setType(t, type); }
    }
    this.emit('announce', { text: `${name} JOINED!`, col: t.css });
    return t;
  }

  /** A network player left: a bot takes the wheel. */
  humanLeave(slot) {
    const t = this.tankById(slot);
    if (!t) return;
    t.human = false;
    t.name = BOT_NAMES[slot * 2 + 1] + ' (bot)';
    t.input.fire = false;
    this.bots.push(new Bot(this, t, this.cfg.difficulty));
  }

  initPickups() {
    this.pickups = this.world.pickupSpots.map((s, i) => {
      const p = { x: s.x, z: s.z, y: this.world.heightAt(s.x, s.z), active: this.cfg.pickups, respawnT: 0, kind: 'health', sub: null, spin: 0 };
      this.rollPickup(p, i);
      return p;
    });
  }

  rollPickup(p, i = -1) {
    const kinds = ['health', 'ammo', 'weapon', 'power'];
    if (i >= 0) p.kind = kinds[i % 4];
    else { const x = this.rng(); p.kind = x < 0.3 ? 'health' : x < 0.58 ? 'ammo' : x < 0.8 ? 'weapon' : 'power'; }
    if (!this.cfg.powerups && p.kind === 'power') p.kind = 'health';
    p.sub = p.kind === 'power' ? POWERUP_ORDER[Math.floor(this.rng() * POWERUP_ORDER.length)] : p.kind === 'weapon' ? pickWeighted(CRATE_WEAPONS, this.rng()) : null;
  }

  restart() {
    this.projectiles = []; this.drops = []; this.strikes = []; this.smokes = []; this.timers = [];
    for (const o of this.world.obstacles) if (o.hp !== undefined || o.soft) { o.alive = true; o.hp = o.kind === 'crate' ? 30 : o.kind === 'barrel' ? 15 : 1; }
    this.world.buildNav();
    this.initPickups();
    this.winner = null; this.firstBlood = false; this.dropT = this.cfg.airdrop;
    this.emit('restart');
  }

  // ---------------- main step ----------------
  step(dt = DT) {
    this.time += dt;
    if (this.timers.length) {
      const due = this.timers.filter((e) => e.t <= this.time);
      if (due.length) { this.timers = this.timers.filter((e) => e.t > this.time); for (const e of due) e.fn(); }
    }
    if (this.state === 'lobby') return;
    if (this.state === 'countdown') {
      this.countdown -= dt;
      const c = Math.ceil(this.countdown - 0.5);
      if (c !== this.lastCount && c >= 1 && c <= 3) { this.emit('count', { n: c }); this.lastCount = c; }
      if (this.countdown <= 0.5) { this.state = 'play'; this.emit('go'); }
    }
    const playing = this.state === 'play';
    if (playing) this.matchTime += dt;
    for (const b of this.bots) b.update(dt);
    for (const t of this.tanks) {
      if (!t.alive) continue;
      this.control(t, playing ? t.input : { ...t.input, throttle: 0, turn: 0, fire: false }, dt);
    }
    for (const t of this.tanks) this.updateTank(t, dt);
    this.collideTanks();
    this.updateProjectiles(dt);
    this.updateStrikes(dt);
    this.updateSmokes(dt);
    this.updatePickups(dt);
    if (playing) this.checkWin();
  }

  // ---------------- tanks ----------------
  control(t, c, dt) {
    const def = t.def;
    const sp = t.power.speed > 0 ? 1.55 : 1;
    // weapon selection
    if (c.weapon && t.weapons[t.wi].id !== c.weapon) {
      const i = t.weapons.findIndex((w) => w.id === c.weapon);
      if (i >= 0) { t.wi = i; t.cooldown = Math.min(t.cooldown, 0.3); }
    }
    // smoke grenades: input.smoke is a counter, each increment throws one volley
    if (c.smoke > t.smokeSeq) { t.smokeSeq = c.smoke; this.throwSmoke(t); }
    // throttle with slope effect
    const fx = Math.sin(t.yaw), fz = Math.cos(t.yaw);
    const L = 1.8 * t.scale;
    const W = this.world;
    const slope = (W.heightAt(t.x + fx * L, t.z + fz * L) - W.heightAt(t.x - fx * L, t.z - fz * L)) / (2 * L);
    let target = c.throttle > 0 ? c.throttle * def.speed * sp : c.throttle * def.reverse * sp;
    target *= 1 - clamp(slope * Math.sign(target || 1) * 1.2, -0.25, 0.65);
    const accel = (Math.sign(target) !== Math.sign(t.speed) && Math.abs(t.speed) > 0.5 ? 2.2 : 1) * def.accel * (c.throttle === 0 ? 0.8 : 1);
    t.speed += clamp(target - t.speed, -accel * dt, accel * dt);
    const turnMul = 1 - Math.min(Math.abs(t.speed) / (def.speed * 2.5), 0.3);
    const dyaw = c.turn * def.turn * turnMul * dt;
    t.yaw = wrapAngle(t.yaw + dyaw);
    // turret slews to the requested world aim at the vehicle's traverse speed
    const bot = !t.human && this.bots.find((b) => b.t === t);
    const tmul = bot ? bot.d.turretMul : 1;
    t.turretYaw = wrapAngle(approachAngle(t.turretYaw, c.aimYaw, def.turret * tmul * dt));
    const ap = clamp(c.aimPitch, def.pitchMin, def.pitchMax);
    t.pitch += clamp(ap - t.pitch, -def.pitchSpeed * dt, def.pitchSpeed * dt);
    // flamer heat
    const W0 = WEAPONS[t.weapons[t.wi].id];
    const flaming = c.fire && W0.kind === 'flame' && t.weapons[t.wi].ammo > 0;
    if (flaming) {
      t.heat = Math.min(FLAME_HEAT.max, t.heat + FLAME_HEAT.perSec * dt);
      const chance = (FLAME_HEAT.base + t.heat * FLAME_HEAT.perHeat) * dt;
      if (this.rng() < chance) this.ignite(t);
    } else t.heat = Math.max(0, t.heat - FLAME_HEAT.cool * dt);
    // rapid-fire spread only settles once you stop shooting
    if (!(c.fire && W0.kind === 'bullet')) t.bloom = Math.max(0, t.bloom - WEAPONS.rapid.recover * dt);
    if (c.fire) this.fire(t, c);
  }

  /** Flamethrower mishap: the fuel tank catches fire. */
  ignite(t) {
    if (!t.alive || t.burnT > 2) return;
    t.heat = 0;
    t.burnT = 4; t.burnBy = t; t.burnDps = 7;
    this.damage(t, 12, t, null, 'fuel');
    this.emit('ignite', { id: t.id, x: r1(t.x), y: r1(t.y), z: r1(t.z) });
    if (t.alive) this.explodeAt(t.x, t.y + 1.5, t.z, t, 0, 4, 10, 0.8, t, 'fuel');
  }

  throwSmoke(t) {
    if (t.smokeAmmo <= 0 || t.smokeCd > this.time || !t.alive) return;
    t.smokeAmmo--;
    t.smokeCd = this.time + SMOKE.cooldown;
    // three canisters in a fan in front of the turret
    for (let i = -1; i <= 1; i++) {
      const a = t.turretYaw + i * 0.6, d = 6 + Math.abs(i) * 2;
      const x = t.x + Math.sin(a) * d, z = t.z + Math.cos(a) * d;
      this.smokes.push({ id: this.nextId++, x, z, r: 2, age: 0, life: SMOKE.life + this.rng() * 2 });
    }
    this.emit('smoke', { id: t.id, x: r1(t.x), z: r1(t.z), yaw: r2(t.turretYaw) });
  }

  updateSmokes(dt) {
    for (const s of this.smokes) { s.age += dt; s.r = Math.min(SMOKE.radius, s.r + SMOKE.grow * 8 * dt); }
    this.smokes = this.smokes.filter((s) => s.age < s.life);
  }

  /** Does the segment pass through smoke (2D, below smoke height)? */
  smokeBlocks(x0, z0, x1, z1) {
    for (const s of this.smokes) {
      if (s.age > s.life - 1.5) continue;
      const dx = x1 - x0, dz = z1 - z0, L2 = dx * dx + dz * dz || 1;
      const u = clamp(((s.x - x0) * dx + (s.z - z0) * dz) / L2, 0, 1);
      if (Math.hypot(x0 + dx * u - s.x, z0 + dz * u - s.z) < s.r * 0.85) return true;
    }
    return false;
  }
  inSmoke(x, z) { return this.smokes.some((s) => s.age < s.life - 1.5 && Math.hypot(x - s.x, z - s.z) < s.r * 0.85); }

  /** Line of sight: terrain, solid obstacles and smoke. */
  los(a, b) {
    return !this.world.segmentBlocked(a.x, a.y + 2, a.z, b.x, b.y + 1.5, b.z) && !this.smokeBlocks(a.x, a.z, b.x, b.z);
  }

  updateTank(t, dt) {
    const W = this.world, def = t.def;
    t.cooldown -= dt;
    t.invulnT = Math.max(0, t.invulnT - dt);
    t.ramT = Math.max(0, t.ramT - dt);
    t.strikeCd = Math.max(0, t.strikeCd - dt);
    for (const k in t.power) if (t.power[k] > 0) { t.power[k] -= dt; if (t.power[k] <= 0) { t.power[k] = 0; if (k === 'shield') t.shieldHp = 0; } }
    if (!t.alive) {
      if (!t.eliminated && this.state !== 'over') { t.respawnT -= dt; if (t.respawnT <= 0) this.spawnTank(t); }
      return;
    }
    if (t.burnT > 0) {
      t.burnT -= dt;
      this.damage(t, t.burnDps * dt, t.burnBy, null, t.burnBy === t ? 'fuel' : 'burn', true);
      if (!t.alive) return;
    }
    // move with collision (drive + knockback velocity)
    const ox = t.x, oz = t.z;
    const kd = Math.exp(-4 * dt);
    t.kx *= kd; t.kz *= kd;
    const nx = t.x + (Math.sin(t.yaw) * t.speed + t.kx) * dt, nz = t.z + (Math.cos(t.yaw) * t.speed + t.kz) * dt;
    const blocked = (x, z) => W.isWater(x, z) || !W.inBounds(x, z);
    if (!blocked(nx, nz)) { t.x = nx; t.z = nz; }
    else if (!blocked(nx, t.z)) { t.x = nx; t.speed *= 0.9; }
    else if (!blocked(t.x, nz)) { t.z = nz; t.speed *= 0.9; }
    else { t.speed *= -0.25; t.kx = t.kz = 0; }
    W.query(t.x, t.z, t.radius, (o) => {
      if (o.soft) { this.breakObstacle(o, t); return; }
      const dx = t.x - o.x, dz = t.z - o.z, d = Math.hypot(dx, dz) || 0.01;
      const pen = t.radius + o.r - d;
      if (pen <= 0) return;
      if ((o.kind === 'crate' || o.kind === 'barrel') && Math.abs(t.speed) > 7 && def.mass >= 1.0) { this.damageObstacle(o, 100, t); t.speed *= 0.7; return; }
      t.x += (dx / d) * pen; t.z += (dz / d) * pen;
      const fwdDot = -(dx / d) * Math.sin(t.yaw) - (dz / d) * Math.cos(t.yaw);
      if (fwdDot * Math.sign(t.speed) > 0.5 && Math.abs(t.speed) > 6 && t.ramT <= 0) {
        this.emit('bump', { x: r1(o.x - (dx / d) * o.r), y: r1(t.y + 1), z: r1(o.z - (dz / d) * o.r), tree: o.kind === 'tree' ? 1 : 0 });
        t.ramT = 0.5;
      }
      t.speed *= 1 - clamp(fwdDot * Math.sign(t.speed), 0, 1) * 0.5;
    });
    t.vx = (t.x - ox) / dt; t.vz = (t.z - oz) / dt;
    // ground follow + tilt
    const fx = Math.sin(t.yaw), fz = Math.cos(t.yaw), rx = Math.cos(t.yaw), rz = -Math.sin(t.yaw);
    const L = 1.7 * t.scale, Wd = 1.1 * t.scale;
    const hF = W.heightAt(t.x + fx * L, t.z + fz * L), hB = W.heightAt(t.x - fx * L, t.z - fz * L);
    const hR = W.heightAt(t.x + rx * Wd, t.z + rz * Wd), hL = W.heightAt(t.x - rx * Wd, t.z - rz * Wd);
    const df = (hF - hB) / (2 * L), dr = (hR - hL) / (2 * Wd);
    const n0 = -df * fx - dr * rx, n1 = 1, n2 = -df * fz - dr * rz, nl = Math.hypot(n0, n1, n2);
    const k = Math.min(1, dt * 10);
    t.n[0] = lerp(t.n[0], n0 / nl, k); t.n[1] = lerp(t.n[1], n1 / nl, k); t.n[2] = lerp(t.n[2], n2 / nl, k);
    const ln = Math.hypot(t.n[0], t.n[1], t.n[2]); t.n[0] /= ln; t.n[1] /= ln; t.n[2] /= ln;
    t.y = lerp(t.y, Math.max((hF + hB + hR + hL) / 4, W.heightAt(t.x, t.z)), Math.min(1, dt * 15));
    this.updateMatrices(t);
  }

  updateMatrices(t) {
    const G = t.geom;
    alignToNormal(t.hullM, t.x, t.y, t.z, t.n, t.yaw, t.scale);
    m4.compose(this.m, 0, G.turretY, 0, t.turretYaw - t.yaw);
    m4.multiply(t.turretM, t.hullM, this.m);
    m4.compose(this.m, 0, G.barrelY, G.barrelZ, 0, -t.pitch, 0);
    m4.multiply(t.barrelM, t.turretM, this.m);
    const b = t.barrelM, L = G.barrelLen;
    t.muzzle[0] = b[12] + b[8] * L; t.muzzle[1] = b[13] + b[9] * L; t.muzzle[2] = b[14] + b[10] * L;
    dirFromYawPitch(t.turretYaw, t.pitch, t.dir); // stabilised gun: aim ignores hull tilt
  }

  collideTanks() {
    const T = this.tanks;
    for (let i = 0; i < T.length; i++) for (let j = i + 1; j < T.length; j++) {
      const a = T[i], b = T[j];
      if (!a.alive || !b.alive) continue;
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz) || 0.01;
      const pen = a.radius + b.radius - d;
      if (pen <= 0) continue;
      const ma = a.def.mass, mb = b.def.mass, tot = ma + mb;
      const nx = dx / d, nz = dz / d;
      a.x -= nx * pen * (mb / tot); a.z -= nz * pen * (mb / tot);
      b.x += nx * pen * (ma / tot); b.z += nz * pen * (ma / tot);
      const rel = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
      if (rel > 6 && a.ramT <= 0 && b.ramT <= 0) {
        const va = a.vx * nx + a.vz * nz, vb = -(b.vx * nx + b.vz * nz);
        const atk = va > vb ? a : b, vic = atk === a ? b : a;
        const s = atk === a ? 1 : -1;
        const dmg = rel * 1.3 * atk.def.mass * (atk.def.id === 'superheavy' ? 1.6 : 1);
        this.damage(vic, dmg, atk, [nx * s, 0, nz * s], 'ram');
        this.damage(atk, (dmg * 0.25) / atk.def.mass, vic, null, 'ram');
        a.ramT = b.ramT = 0.6;
        vic.kx += nx * s * rel * 0.6 * atk.def.mass / vic.def.mass; vic.kz += nz * s * rel * 0.6 * atk.def.mass / vic.def.mass;
        atk.speed *= 0.5;
        this.emit('ram', { x: r1((a.x + b.x) / 2), y: r1((a.y + b.y) / 2 + 1), z: r1((a.z + b.z) / 2) });
      }
    }
  }

  // ---------------- weapons ----------------
  fire(t, c) {
    const w = t.weapons[t.wi];
    const W = WEAPONS[w.id];
    if (t.cooldown > 0 || !t.alive) return;
    if (W.kind === 'strike' && t.strikeCd > 0) return;
    if (w.ammo <= 0) {
      t.cooldown = 0.3;
      if (t.human) this.emit('empty', { id: t.id });
      // auto-switch to something with ammo
      const i = t.weapons.findIndex((x) => x.ammo > 0);
      if (i >= 0 && !t.human) t.wi = i;
      return;
    }
    const dmgMul = (t.power.damage > 0 ? 2 : 1) * (w.id === 'standard' ? t.def.gun.dmg : 1);
    const reloadMul = (t.power.rapid > 0 ? 0.5 : 1) * (w.id === 'standard' ? t.def.gun.reload : 1);
    w.ammo--;
    t.stats.shots++;
    t.stats.byWeapon[w.id] = t.stats.byWeapon[w.id] || { shots: 0, hits: 0, dmg: 0 };
    t.stats.byWeapon[w.id].shots++;
    t.cooldown = W.reload * reloadMul;
    const [mx, my, mz] = t.muzzle;
    let yaw = t.turretYaw, pitch = t.pitch;
    let spread = W.spread || 0;
    if (W.kind === 'bullet') {
      spread += t.bloom;
      t.bloom = Math.min(W.maxBloom, t.bloom + W.bloom);
      // hard to control: every shot kicks the turret and barrel
      t.turretYaw = wrapAngle(t.turretYaw + (this.rng() - 0.5) * 2 * W.kick);
      t.pitch = clamp(t.pitch + this.rng() * W.kick * 0.6, t.def.pitchMin, t.def.pitchMax);
    }
    if (spread) { yaw += (this.rng() - 0.5) * 2 * spread; pitch += (this.rng() - 0.5) * spread; }
    if (W.kind === 'seeker' || W.kind === 'strike') pitch = Math.max(pitch, W.launchPitch);
    const d = dirFromYawPitch(yaw, pitch);
    const splashMul = w.id === 'standard' ? t.def.gun.splash || 1 : 1;
    const base = { owner: t, w: w.id, W, x: mx, y: my, z: mz, age: 0, id: this.nextId++, dmg: W.dmg * dmgMul, splash: (W.splash || 0) * splashMul, splashDmg: (W.splashDmg || 0) * dmgMul };
    let p;
    if (W.kind === 'flame') {
      const v = W.speed * (0.85 + this.rng() * 0.3);
      p = { ...base, kind: 'flame', vx: d[0] * v + t.vx, vy: d[1] * v + 1, vz: d[2] * v + t.vz, g: -2, life: W.range / W.speed, hitSet: new Set() };
      this.projectiles.push(p);
      if (this.rng() < 0.35) this.emit('fire', { id: t.id, w: w.id });
      return;
    }
    if (W.kind === 'seeker' || W.kind === 'strike') {
      // launched steeply; speed chosen so the arc lands at the aimed range
      const dist = clamp(c.aimDist || 60, W.minRange || 15, W.range);
      const v = seekerSpeed(dist, W.gravity, W.launchPitch);
      const dd = dirFromYawPitch(t.turretYaw, W.launchPitch);
      p = { ...base, kind: W.kind === 'seeker' ? 'seeker' : 'flare', vx: dd[0] * v, vy: dd[1] * v, vz: dd[2] * v, g: W.gravity, life: 12 };
      if (W.kind === 'seeker') {
        const lt = c.lock >= 0 ? this.tankById(c.lock) : null;
        if (lt && this.lockValid(t, lt, 0.35)) { p.target = lt; this.emit('locked', { id: t.id, target: lt.id }); }
      } else t.strikeCd = W.cooldown;
    } else {
      const v = shotSpeed(t.def, w.id);
      p = { ...base, kind: W.kind, vx: d[0] * v, vy: d[1] * v, vz: d[2] * v, g: shotGravity(t.def, w.id), life: W.kind === 'bullet' ? W.range / v : 10 };
    }
    this.projectiles.push(p);
    if (W.hv) { t.kx -= Math.sin(t.turretYaw) * W.selfKnock; t.kz -= Math.cos(t.turretYaw) * W.selfKnock; }
    this.emit('fire', { id: t.id, w: w.id });
  }

  /** Lock is valid when the target is in range, near the gun line, visible and not hidden in smoke. */
  lockValid(t, e, cone = 0.2) {
    if (!e.alive || e === t || e.power.ghost > 0) return false;
    const dx = e.x - t.x, dz = e.z - t.z, d = Math.hypot(dx, dz);
    if (d > WEAPONS.seeker.range || d < 10) return false;
    if (Math.abs(wrapAngle(Math.atan2(dx, dz) - t.turretYaw)) > cone) return false;
    if (this.inSmoke(e.x, e.z) || this.smokeBlocks(t.x, t.z, e.x, e.z)) return false;
    return true;
  }

  updateProjectiles(dt) {
    const W = this.world;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.age += dt;
      if (p.age > p.life) { this.projectiles.splice(i, 1); continue; }
      if (p.kind === 'seeker' && p.target && p.vy < 0) {
        const e = p.target;
        if (!e.alive || this.inSmoke(e.x, e.z)) { p.target = null; this.emit('lost', { pid: p.id }); }
        else {
          // guidance during the dive: arrive where the target will be at impact, with limited lateral acceleration
          const h = Math.max(0, p.y - this.world.heightAt(p.x, p.z) - 1);
          const tRem = Math.max(0.15, (p.vy + Math.sqrt(p.vy * p.vy + 2 * p.g * h)) / p.g);
          const tx = e.x + e.vx * tRem * 0.8 - p.x, tz = e.z + e.vz * tRem * 0.8 - p.z;
          const wantX = tx / tRem, wantZ = tz / tRem;
          const dvx = wantX - p.vx, dvz = wantZ - p.vz, dl = Math.hypot(dvx, dvz) || 1;
          const maxDv = p.W.homing * 6 * dt; // m/s per step
          const k = Math.min(1, maxDv / dl);
          p.vx += dvx * k; p.vz += dvz * k;
        }
      }
      if (p.kind === 'flame') { const d = Math.exp(-1.5 * dt); p.vx *= d; p.vz *= d; }
      p.vy -= p.g * dt;
      // cluster shells open just before they would land, so the bomblets carry on over the target
      const hAbove = p.y - W.heightAt(p.x + p.vx * 0.3, p.z + p.vz * 0.3);
      const tGround = p.vy < 0 ? (p.vy + Math.sqrt(p.vy * p.vy + 2 * p.g * Math.max(0, hAbove))) / p.g : 9;
      if (p.kind === 'cluster' && p.age > 0.25 && (tGround < 0.45 || hAbove < 1.5)) {
        this.burstCluster(p);
        this.projectiles.splice(i, 1);
        continue;
      }
      const steps = Math.max(1, Math.ceil((Math.hypot(p.vx, p.vy, p.vz) * dt) / 1.2));
      let done = false;
      for (let s = 0; s < steps && !done; s++) {
        p.x += (p.vx * dt) / steps; p.y += (p.vy * dt) / steps; p.z += (p.vz * dt) / steps;
        done = this.projectileHit(p);
      }
      if (done) this.projectiles.splice(i, 1);
    }
  }

  burstCluster(p) {
    const W = p.W, Wd = this.world;
    this.emit('cluster', { x: r1(p.x), y: r1(p.y), z: r1(p.z) });
    // where would the shell have landed? the bomblets fan out in a ring around that point
    let ix = p.x, iy = p.y, iz = p.z, vx = p.vx, vy = p.vy, vz = p.vz;
    for (let i = 0; i < 240; i++) {
      vy -= p.g * DT; ix += vx * DT; iy += vy * DT; iz += vz * DT;
      if (iy < Wd.heightAt(ix, iz)) break;
    }
    const g = 22;
    for (let i = 0; i < W.bomblets; i++) {
      const a = (i / W.bomblets) * Math.PI * 2 + this.rng() * 0.5, r = Math.sqrt(0.15 + this.rng() * 0.85) * W.spreadR;
      const tx = ix + Math.cos(a) * r, tz = iz + Math.sin(a) * r;
      const vy0 = 3 + this.rng() * 3, h = Math.max(0.5, p.y - Wd.heightAt(tx, tz));
      const tf = (vy0 + Math.sqrt(vy0 * vy0 + 2 * g * h)) / g;
      this.projectiles.push({
        owner: p.owner, w: 'cluster', W, kind: 'bomblet', id: this.nextId++, age: 0, life: 6,
        x: p.x, y: p.y, z: p.z, vx: (tx - p.x) / tf, vy: vy0, vz: (tz - p.z) / tf, g,
        dmg: 0, splash: W.bombletSplash, splashDmg: W.bombletDmg * (p.dmg / W.dmg),
      });
    }
  }

  /** Returns true when the projectile is consumed. */
  projectileHit(p) {
    const W = this.world;
    if (!W.inBounds(p.x, p.z, -20) && p.kind !== 'bomb') return true; // bombs released off-map still fall onto it
    const big = p.kind === 'shell' && p.W.nuke;
    for (const t of this.tanks) {
      if (!t.alive || (t === p.owner && p.age < 0.4)) continue;
      if (p.kind === 'flame' && (t === p.owner || p.hitSet.has(t))) continue;
      if (p.kind === 'flare') continue;
      const r = t.radius * (p.kind === 'flame' ? 1.4 : 1.0);
      if (Math.hypot(t.x - p.x, t.z - p.z) < r && p.y > t.y - 0.4 && p.y < t.y + 2.6 * t.scale) {
        if (p.kind === 'flame') {
          p.hitSet.add(t);
          this.damage(t, p.dmg, p.owner, null, 'flame');
          if (t.power.shield <= 0) { t.burnT = Math.max(t.burnT, p.W.burn); t.burnBy = p.owner; t.burnDps = p.W.burnDps; }
          return false;
        }
        this.damage(t, p.dmg, p.owner, [p.vx, 0, p.vz], p.w);
        if (p.W.hv) {
          const hl = Math.hypot(p.vx, p.vz) || 1;
          t.kx += (p.vx / hl) * p.W.knock; t.kz += (p.vz / hl) * p.W.knock;
          this.emit('hvhit', { x: r1(p.x), y: r1(p.y), z: r1(p.z), id: t.id });
        }
        this.detonate(p, p.dmg > 0 ? t : null); // munitions with no direct damage still splash the tank they hit
        return true;
      }
    }
    // obstacles: falling munitions (seekers, bomblets, bombs) are caught by tree canopies
    let hitO = null;
    const falling = (p.kind === 'seeker' || p.kind === 'bomb' || p.kind === 'bomblet') && p.vy < 0;
    W.query(p.x, p.z, falling ? 3.6 : 0.2, (o) => {
      if (p.y > o.top) return;
      const d = Math.hypot(o.x - p.x, o.z - p.z);
      if (falling && o.cr && d < o.cr && p.y > o.cb) { hitO = o; return false; } // caught in the canopy
      if (d > o.r + 0.2) return;
      if (o.soft && (p.kind === 'bullet' || p.kind === 'flame' || p.kind === 'flare')) { if (o.kind === 'bush' && p.kind === 'flame') this.breakObstacle(o, p.owner); return; }
      hitO = o; return false;
    });
    if (hitO) {
      if (p.kind === 'flame') return true;
      if (p.kind === 'flare') { this.markStrike(p); return true; }
      if (hitO.hp) this.damageObstacle(hitO, p.kind === 'bullet' ? p.dmg : p.dmg + (p.splashDmg || 0), p.owner);
      if (hitO.kind === 'tree') this.emit('leaves', { x: r1(hitO.x), y: r1(Math.min(p.y + 2, hitO.top)), z: r1(hitO.z), n: p.kind === 'bullet' ? 2 : 10, canopy: p.kind === 'seeker' && falling ? 1 : 0 });
      this.detonate(p, null);
      return true;
    }
    const gh = W.heightAt(p.x, p.z);
    if (p.y < gh || (gh < WATER_LEVEL && p.y < WATER_LEVEL)) {
      if (p.kind === 'flame') return true;
      if (p.kind === 'flare') { this.markStrike(p); return true; }
      if (gh < WATER_LEVEL && p.y < WATER_LEVEL + 0.1 && !big) {
        this.emit('splash', { x: r1(p.x), z: r1(p.z), s: p.splash ? 1.4 : 0.5 });
        if (p.splash > 3) this.explodeAt(p.x, WATER_LEVEL, p.z, p.owner, 0, p.splash * 0.6, p.splashDmg * 0.5, 0, null, p.w, true);
        return true;
      }
      p.y = Math.max(p.y, gh + 0.2);
      this.detonate(p, null);
      return true;
    }
    return false;
  }

  detonate(p, exclude) {
    if (p.kind === 'cluster') { this.burstCluster(p); return; }
    if (p.kind === 'bullet') { this.emit('impact', { x: r1(p.x), y: r1(p.y), z: r1(p.z) }); return; }
    if (p.kind === 'shell' && p.W.nuke) { this.nuke(p.x, p.y, p.z, p.owner, p.splashDmg, p.splash); return; }
    const size = p.kind === 'bomblet' ? 0.75 : p.kind === 'bomb' ? 1.7 : p.W.hv ? 0.9 : p.kind === 'seeker' ? 1.3 : p.kind === 'cluster' ? 1 : 1;
    if (p.splash) this.explodeAt(p.x, p.y, p.z, p.owner, 0, p.splash, p.splashDmg, size, exclude, p.w);
  }

  nuke(x, y, z, owner, dmg, radius) {
    this.emit('nuke', { x: r1(x), y: r1(y), z: r1(z) });
    this.explodeAt(x, y, z, owner, 0, radius, dmg, 0, null, 'massive', true);
    // the blast wave keeps flattening scenery and shoving tanks a moment later
    this.later(0.25, () => {
      this.world.query(x, z, radius * 1.3, (o) => { if (o.hp || o.soft) this.damageObstacle(o, 999, owner); });
      for (const t of this.tanks) {
        const dx = t.x - x, dz = t.z - z, d = Math.hypot(dx, dz) || 1;
        if (d < radius * 2.2) { const k = (1 - d / (radius * 2.2)) * 22; t.kx += (dx / d) * k; t.kz += (dz / d) * k; }
      }
    });
  }

  /** Explosion with splash damage, scenery destruction, knockback and chain reactions. */
  explodeAt(x, y, z, owner, directDmg, radius, splashDmg, size, exclude = null, cause = 'blast', silent = false) {
    if (!silent) this.emit('boom', { x: r1(x), y: r1(y), z: r1(z), s: r2(size), c: cause });
    if (directDmg > 0) {
      let best = null, bd = radius * 0.5;
      for (const t of this.tanks) {
        if (!t.alive || t === exclude) continue;
        const d = Math.hypot(t.x - x, t.z - z) - t.radius;
        if (d < bd) { bd = d; best = t; }
      }
      if (best) { this.damage(best, directDmg, owner, [best.x - x, 0, best.z - z], cause); exclude = best; }
    }
    for (const t of this.tanks) {
      if (!t.alive || t === exclude) continue;
      const d = Math.hypot(t.x - x, t.z - z, (t.y + 1) - y);
      if (d < radius + t.radius) {
        const k = 1 - clamp((d - t.radius) / radius, 0, 1);
        const self = t === owner ? 0.5 : 1;
        this.damage(t, splashDmg * k * self, owner, [t.x - x, 0, t.z - z], cause);
        const dl = Math.hypot(t.x - x, t.z - z) || 1;
        const kb = k * (2 + radius * 0.35) / t.def.mass;
        t.kx += ((t.x - x) / dl) * kb; t.kz += ((t.z - z) / dl) * kb;
      }
    }
    this.world.query(x, z, radius * 0.8, (o) => { if (o.hp || o.soft) this.damageObstacle(o, splashDmg + 20, owner); });
  }

  breakObstacle(o, by) {
    if (!o.alive) return;
    o.alive = false;
    this.emit('obs', { i: o.index, k: o.kind });
  }

  damageObstacle(o, dmg, by) {
    if (!o.alive) return;
    if (o.soft) { this.breakObstacle(o, by); return; }
    if (!o.hp) return;
    o.hp -= dmg;
    if (o.hp > 0) return;
    this.breakObstacle(o, by);
    if (o.kind === 'crate' && this.cfg.pickups && this.rng() < 0.45) {
      const p = { x: o.x, z: o.z, y: this.world.heightAt(o.x, o.z), active: true, respawnT: 0, spin: 0, temp: 20, kind: 'ammo', sub: null };
      this.rollPickup(p);
      this.pickups.push(p);
    } else if (o.kind === 'barrel') {
      this.later(0.06 + this.rng() * 0.09, () => this.explodeAt(o.x, o.y + 0.8, o.z, by, 0, 7, 40, 2.2, null, 'barrel'));
    }
    this.world.refreshNavAround(o.x, o.z, 6);
  }

  damage(t, amount, by, dir, cause, silent = false) {
    if (!t.alive || amount <= 0 || this.state === 'over' || this.state === 'lobby') return;
    if (t.invulnT > 0) return;
    let a = amount * t.def.armor;
    if (t.shieldHp > 0) {
      const ab = Math.min(t.shieldHp, a);
      t.shieldHp -= ab; a -= ab;
      if (!silent) this.emit('shield', { id: t.id });
      if (t.shieldHp <= 0) t.power.shield = 0;
    }
    if (a <= 0) return;
    t.hp -= a;
    if (by && by !== t) {
      t.lastHitBy = by; t.lastHitT = this.time;
      by.stats.dmg += a;
      const bw = by.stats.byWeapon[cause === 'burn' ? 'flame' : cause];
      if (bw) { bw.dmg += a; if (!silent) bw.hits++; }
      if (!silent) by.stats.hits++;
    }
    if (!silent || this.rng() < 0.08) {
      this.emit('hit', { id: t.id, a: Math.round(a), by: by ? by.id : -1, dir: dir ? r2(Math.atan2(-dir[0], -dir[2])) : null, c: cause });
    }
    if (t.hp <= 0) this.kill(t, by, cause);
  }

  kill(t, by, cause) {
    t.alive = false;
    t.hp = 0;
    t.deaths++;
    t.streak = 0;
    t.respawnT = this.cfg.respawn;
    t.speed = 0; t.burnT = 0;
    if (this.cfg.lives > 0) { t.lives--; if (t.lives <= 0) t.eliminated = true; }
    this.emit('kill', { id: t.id, by: by ? by.id : -1, c: cause, x: r1(t.x), y: r1(t.y), z: r1(t.z), ty: r2(t.turretYaw) });
    this.explodeAt(t.x, t.y + 1, t.z, by, 0, 6, 15, 0, t, 'chain', true);
    if (by && by !== t) {
      by.kills++; by.score++; by.streak++;
      const multi = this.time - by.lastKillT < 4;
      by.lastKillT = this.time;
      let text = null;
      if (!this.firstBlood) { this.firstBlood = true; text = 'FIRST BLOOD!'; }
      else if (multi) text = 'DOUBLE KILL!';
      else if (by.streak === 3) text = by.name.replace(' (bot)', '') + ' IS ON A ROLL!';
      else if (by.streak === 5) text = by.name.replace(' (bot)', '') + ' IS UNSTOPPABLE!';
      if (text) this.emit('announce', { text, col: by.css });
    } else t.score = Math.max(0, t.score - 1);
  }

  // ---------------- air strikes ----------------
  markStrike(p) {
    const W = p.W, x = p.x, z = p.z;
    const s = { id: this.nextId++, x, z, r: W.radius, t: W.delay, owner: p.owner, run: false };
    this.strikes.push(s);
    this.emit('strike', { sid: s.id, x: r1(x), z: r1(z), r: W.radius, t: W.delay, by: p.owner.id });
  }

  updateStrikes(dt) {
    const W = WEAPONS.strike;
    for (const s of this.strikes) {
      s.t -= dt;
      // the jets cross the zone centre at s.t = jetCross; they appear jetLead metres out along their heading
      if (!s.run && s.t <= W.jetCross + W.jetLead / W.jetSpeed) {
        s.run = true;
        const a = this.rng() * Math.PI * 2;
        const dx = Math.cos(a), dz = Math.sin(a), nx = -dz, nz = dx; // heading and its left-hand side
        const a0 = -W.jetSpeed * (s.t - W.jetCross); // jets' distance along the heading from the centre right now
        const relY = this.world.heightAt(s.x, s.z) + W.jetAlt - 1.2; // bomb bay, just under the jets
        this.emit('strikeRun', { sid: s.id, x: r1(s.x), z: r1(s.z), dx: r2(dx), dz: r2(dz), a0: r1(a0) });
        for (let i = 0; i < W.bombs; i++) {
          // uniform spread over the disc (a little denser in the middle), carpet-bombed along the flight path
          const rr = Math.pow(this.rng(), 0.7) * s.r, aa = this.rng() * Math.PI * 2;
          const bx = s.x + Math.cos(aa) * rr, bz = s.z + Math.sin(aa) * rr;
          const along = (bx - s.x) * dx + (bz - s.z) * dz, side = (bx - s.x) * nx + (bz - s.z) * nz;
          const lane = W.jetLanes.reduce((b, l) => (Math.abs(l - side) < Math.abs(b - side) ? l : b));
          // free fall from the bomb bay: released bombFwd*tf short of the impact point, the moment the jet is overhead
          const tf = Math.sqrt((2 * Math.max(2, relY - this.world.heightAt(bx, bz))) / W.bombG);
          const ra = along - W.bombFwd * tf, vs = (side - lane) / tf;
          this.later(Math.max(0, (ra - a0) / W.jetSpeed), () => {
            this.projectiles.push({ owner: s.owner, w: 'strike', W, kind: 'bomb', id: this.nextId++, age: 0, life: 6, x: s.x + dx * ra + nx * lane, y: relY, z: s.z + dz * ra + nz * lane, vx: dx * W.bombFwd + nx * vs, vy: 0, vz: dz * W.bombFwd + nz * vs, g: W.bombG, dmg: 0, splash: W.bombSplash, splashDmg: W.bombDmg });
          });
        }
      }
    }
    this.strikes = this.strikes.filter((s) => s.t > -2);
  }

  // ---------------- pickups ----------------
  updatePickups(dt) {
    if (!this.cfg.pickups) return;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      if (p.temp !== undefined) { p.temp -= dt; if (p.temp <= 0) { this.pickups.splice(i, 1); continue; } }
      if (!p.active) {
        p.respawnT -= dt;
        if (p.respawnT <= 0) { this.rollPickup(p); p.active = true; this.emit('pickupSpawn', { x: r1(p.x), z: r1(p.z) }); }
        continue;
      }
      for (const t of this.tanks) {
        if (!t.alive || Math.hypot(t.x - p.x, t.z - p.z) > t.radius + 1.6) continue;
        if (this.collect(t, p)) {
          p.active = false;
          p.respawnT = PICKUP_KINDS[p.kind].respawn * (0.8 + this.rng() * 0.4);
          if (p.temp !== undefined) this.pickups.splice(i, 1);
          break;
        }
      }
    }
    if (this.cfg.airdrop > 0 && this.state === 'play') {
      this.dropT -= dt;
      if (this.dropT <= 0) { this.dropT = this.cfg.airdrop; this.spawnAirdrop(); }
    }
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.y -= dt * 6;
      if (d.y <= d.gy + 0.8) {
        this.drops.splice(i, 1);
        this.pickups.push({ x: d.x, z: d.z, y: d.gy, active: true, respawnT: 0, spin: 0, kind: d.kind, sub: d.sub, temp: 40 });
        this.emit('landed', { x: r1(d.x), z: r1(d.z) });
      }
    }
  }

  spawnAirdrop() {
    const W = this.world;
    for (let tries = 0; tries < 50; tries++) {
      const x = (this.rng() - 0.5) * W.size * 0.6, z = (this.rng() - 0.5) * W.size * 0.6;
      if (!W.canPlace(x, z, 2, { noPath: false, spawnClear: 10, gap: 1 }) || !W.reachable(x, z)) continue;
      const gy = W.heightAt(x, z);
      const heavy = this.rng() < 0.5;
      this.drops.push({ id: this.nextId++, x, z, y: gy + 70, gy, kind: heavy ? 'weapon' : 'power', sub: heavy ? pickWeighted([['massive', 1], ['strike', 1], ['cluster', 1], ['highvel', 1]], this.rng()) : POWERUP_ORDER[Math.floor(this.rng() * POWERUP_ORDER.length)] });
      this.emit('announce', { text: 'SUPPLY DROP INCOMING!', col: '#ffd84d', drop: 1 });
      return;
    }
  }

  collect(t, p) {
    let label = '';
    let col = PICKUP_KINDS[p.kind].css;
    if (p.kind === 'health') {
      if (t.hp >= t.maxHp) return false;
      t.hp = Math.min(t.maxHp, t.hp + PICKUP_KINDS.health.amount);
      t.burnT = 0;
      label = '+HEALTH';
    } else if (p.kind === 'ammo') {
      if (t.weapons.every((w) => w.ammo >= WEAPONS[w.id].maxAmmo) && t.smokeAmmo >= t.def.smoke) return false;
      for (const w of t.weapons) w.ammo = Math.min(WEAPONS[w.id].maxAmmo, w.ammo + Math.max(1, Math.ceil(WEAPONS[w.id].maxAmmo * 0.5)));
      t.smokeAmmo = Math.min(t.def.smoke, t.smokeAmmo + 1);
      label = '+AMMO';
    } else if (p.kind === 'weapon') {
      const W = WEAPONS[p.sub];
      let w = t.weapons.find((x) => x.id === p.sub);
      if (!w) { w = { id: p.sub, ammo: 0 }; t.weapons.push(w); }
      // already full (e.g. Super Heavy spawns with its one MASSIVE, Artillery with full cluster/strike):
      // never leave a box you can't take, swap it for a random power-up instead
      if (w.ammo >= W.maxAmmo) return this.collect(t, { ...p, kind: 'power', sub: POWERUP_ORDER[Math.floor(this.rng() * POWERUP_ORDER.length)] });
      w.ammo = Math.min(W.maxAmmo, w.ammo + Math.max(1, Math.ceil(W.maxAmmo * 0.6)));
      label = '+' + W.name.toUpperCase();
    } else if (p.kind === 'power') {
      const P = POWERUPS[p.sub];
      t.power[p.sub] = P.dur;
      if (p.sub === 'shield') t.shieldHp = P.absorb;
      label = P.name.toUpperCase() + '!';
      col = P.css;
    }
    t.stats.pickups++;
    this.emit('pickup', { id: t.id, k: p.kind, s: p.sub, label, col, x: r1(p.x), y: r1(p.y), z: r1(p.z) });
    return true;
  }

  // ---------------- rules ----------------
  checkWin() {
    const cfg = this.cfg;
    let winner = null, reason = '';
    if (cfg.lives > 0) {
      const left = this.tanks.filter((t) => !t.eliminated);
      if (left.length === 1) { winner = left[0]; reason = 'Last tank standing'; }
      else if (left.length === 0) {
        const ranked = [...this.tanks].sort((a, b) => b.score - a.score);
        winner = ranked[1] && ranked[0].score === ranked[1].score ? 'draw' : ranked[0];
        reason = winner === 'draw' ? 'Mutual destruction — draw!' : 'Mutual destruction';
      }
    }
    if (!winner && cfg.scoreLimit > 0) {
      const top = this.tanks.find((t) => t.score >= cfg.scoreLimit);
      if (top) { winner = top; reason = `First to ${cfg.scoreLimit}`; }
    }
    if (!winner && cfg.timeLimit > 0 && this.matchTime >= cfg.timeLimit) {
      const ranked = [...this.tanks].sort((a, b) => b.score - a.score || a.deaths - b.deaths);
      const tie = ranked[1] && ranked[0].score === ranked[1].score && ranked[0].deaths === ranked[1].deaths;
      winner = tie ? 'draw' : ranked[0];
      reason = tie ? 'Time up — dead heat!' : 'Time up';
    }
    if (winner) {
      this.state = 'over';
      this.overT = 0;
      this.winner = winner === 'draw' ? null : winner;
      this.winReason = reason;
      for (const t of this.tanks) t.input.fire = false;
      this.emit('win', { id: this.winner ? this.winner.id : -1, reason });
    }
  }

  // ---------------- network snapshot ----------------
  snapshot() {
    return {
      time: r2(this.time), state: this.state, cd: r2(this.countdown), mt: r1(this.matchTime),
      win: this.winner ? this.winner.id : -1, why: this.winReason || '',
      tanks: this.tanks.map((t) => ({
        id: t.id, name: t.name, type: t.def.id, h: t.human ? 1 : 0, x: r2(t.x), y: r2(t.y), z: r2(t.z), yaw: r3(t.yaw), ty: r3(t.turretYaw), p: r3(t.pitch),
        hp: Math.ceil(t.hp), mhp: t.maxHp, al: t.alive ? 1 : 0, el: t.eliminated ? 1 : 0, wi: t.wi, w: t.weapons.map((w) => [w.id, w.ammo]),
        pw: Object.fromEntries(Object.entries(t.power).filter(([, v]) => v > 0).map(([k, v]) => [k, r1(v)])), sh: Math.ceil(t.shieldHp),
        inv: r1(t.invulnT), burn: t.burnT > 0 ? 1 : 0, heat: r2(t.heat), bloom: r3(t.bloom), sm: t.smokeAmmo, scd: r1(t.strikeCd), cd: r2(Math.max(0, t.cooldown)),
        k: t.kills, d: t.deaths, s: t.score, l: t.lives, rt: r1(Math.max(0, t.respawnT)), vx: r1(t.vx), vz: r1(t.vz), spd: r1(t.speed),
      })),
      proj: this.projectiles.filter((p) => p.kind !== 'flame').map((p) => [p.id, p.kind, p.w, r2(p.x), r2(p.y), r2(p.z), r1(p.vx), r1(p.vy), r1(p.vz), r1(p.g), p.target ? p.target.id : -1]),
      pick: this.pickups.map((p) => [p.active ? 1 : 0, p.kind, p.sub, r1(p.x), r1(p.z), p.temp !== undefined ? r1(p.temp) : -1]),
      drops: this.drops.map((d) => [d.id, r1(d.x), r1(d.y), r1(d.z), r1(d.gy)]),
      strikes: this.strikes.map((s) => [s.id, r1(s.x), r1(s.z), s.r, r2(s.t), s.owner.id]),
      smokes: this.smokes.map((s) => [s.id, r1(s.x), r1(s.z), r1(s.r), r1(s.age), r1(s.life)]),
    };
  }
}
