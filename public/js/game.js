// Core game: match flow, tanks, physics, weapons, pickups, cameras and render submission.
import { Renderer } from './gl.js';
import { createModels, TANK_GEOM } from './models.js';
import { World, WATER_LEVEL } from './world.js';
import { FX } from './fx.js';
import { Sound } from './audio.js';
import { Input, KEYMAPS } from './input.js';
import { Bot, ballisticPitch } from './ai.js';
import { HUD } from './hud.js';
import { TANK_TYPES, TANK_ORDER, WEAPONS, POWERUPS, POWERUP_ORDER, PICKUP_KINDS, CRATE_WEAPONS, PLAYER_COLORS } from './defs.js';
import { m4, clamp, lerp, wrapAngle, approachAngle, makeRng, alignToNormal, dirFromYawPitch } from './math.js';

const DT = 1 / 60;
const BOT_NAMES = ['Sarge', 'Tinker', 'Rusty', 'Boomer', 'Dozer', 'Pip', 'Gizmo', 'Nugget', 'Sprocket', 'Chomp'];

export class Game {
  constructor(canvas, hudCanvas, cfg) {
    this.cfg = cfg;
    this.canvas = canvas;
    this.renderer = new Renderer(canvas, { shadows: cfg.shadows, shadowSize: cfg.quality === 'low' ? 1024 : 2048, preserve: cfg.debug });
    this.rng = makeRng(cfg.seed);
    this.M = createModels(this.renderer, makeRng(cfg.seed + 1));
    this.world = new World(this.renderer, this.M, cfg);
    this.fx = new FX(this.M, this.world);
    this.sound = new Sound(cfg);
    this.input = new Input(canvas);
    this.hud = new HUD(hudCanvas, this);
    this.m = m4.create(); this.m2 = m4.create(); this.m3 = m4.create();
    this.view = m4.create(); this.proj = m4.create();
    this.time = 0;
    this.realTime = 0;
    this.acc = 0;
    this.state = cfg.lobby ? 'lobby' : 'countdown';
    this.countdown = 3.5;
    this.matchTime = 0;
    this.tanks = [];
    this.projectiles = [];
    this.mines = [];
    this.beams = [];
    this.debris = [];
    this.pickups = [];
    this.drops = [];
    this.killfeed = [];
    this.announce = [];
    this.shake = 0;
    this.cams = [];
    this.dropT = cfg.airdrop;
    this.winner = null;
    this.firstBlood = false;
    this.fps = 60; this.frameMs = 16;
    this.events = []; // sim-time scheduled callbacks (pause/fast-forward safe)
    // lobby slots: humans pre-joined from --players
    this.slots = [0, 1, 2, 3].map((i) => ({
      slot: i,
      human: i < cfg.players,
      joined: i < cfg.players,
      type: cfg.tanks[i] || TANK_ORDER[(i + 1) % TANK_ORDER.length],
    }));
    this.lobbyT = cfg.lobbyTimeout;
    this.initPickups();
    if (this.state !== 'lobby') this.startMatch();
  }

  // ---------------- match setup ----------------
  startMatch() {
    const cfg = this.cfg;
    this.tanks = [];
    this.bots = [];
    const humans = this.slots.filter((s) => s.joined);
    let botCount = cfg.bots === 'auto' ? 4 - humans.length : Math.min(cfg.bots, 4 - humans.length);
    if (humans.length === 0 && botCount < 2) botCount = 2;
    const order = [];
    humans.forEach((s) => order.push({ human: true, slot: s.slot, type: s.type }));
    const usedNames = new Set();
    for (let i = 0; i < botCount; i++) {
      const free = [0, 1, 2, 3].find((k) => !order.some((o) => o.color === k) && !humans.some((h) => h.slot === k) && !order.some((o) => !o.human && o.slot === k));
      const type = cfg.botTanks[i] || TANK_ORDER[Math.floor(this.rng() * TANK_ORDER.length)];
      let name;
      do name = BOT_NAMES[Math.floor(this.rng() * BOT_NAMES.length)]; while (usedNames.has(name));
      usedNames.add(name);
      order.push({ human: false, slot: free, type, name });
    }
    order.forEach((o, idx) => {
      const t = this.makeTank(o.type, o.slot, o.human, o.human ? `P${o.slot + 1}` : `${o.name} (bot)`);
      t.spawnIdx = idx;
      this.tanks.push(t);
      if (!o.human) this.bots.push(new Bot(this, t, cfg.difficulty));
    });
    for (const t of this.tanks) this.spawnTank(t, true);
    this.humans = this.tanks.filter((t) => t.human).sort((a, b) => a.slot - b.slot);
    this.state = 'countdown';
    this.countdown = 3.5;
    this.matchTime = 0;
    this.lastCount = 4;
    this.cams = [];
  }

  makeTank(typeId, slot, human, name) {
    const def = TANK_TYPES[typeId];
    const col = PLAYER_COLORS[slot];
    return {
      id: slot, slot, human, name, def, geom: TANK_GEOM[typeId], color: col.rgb, css: col.css,
      x: 0, y: 0, z: 0, yaw: 0, speed: 0, vx: 0, vz: 0, turretYaw: 0, aimYaw: 0, pitch: 0.05, aimPitch: 0.05,
      hp: def.hp, maxHp: def.hp, alive: false, respawnT: 0, invulnT: 0, eliminated: false,
      weapons: [], wi: 0, cooldown: 0, recoil: 0, flashT: 0, burnT: 0, burnBy: null,
      power: { speed: 0, shield: 0, damage: 0, rapid: 0, ghost: 0 }, shieldHp: 0,
      kills: 0, deaths: 0, score: 0, streak: 0, lastKillT: -10, lives: this.cfg.lives,
      lastHitBy: null, lastHitT: -10, n: [0, 1, 0], radius: def.radius, scale: def.scale,
      trackAcc: 0, ramT: 0, mouseAim: false, hitMarkT: 0, dmgDir: null, dmgT: 0, camKick: 0,
      wreckT: 0, zoom: false, lookPitch: 0, hullM: m4.create(), turretM: m4.create(), barrelM: m4.create(),
      muzzle: [0, 0, 0], dir: [0, 0, 1], stats: { shots: 0, hits: 0, dmg: 0, pickups: 0 },
    };
  }

  spawnTank(t, initial = false) {
    const sp = this.world.spawns;
    let best = sp[t.spawnIdx % sp.length];
    if (!initial) {
      // farthest spawn from living enemies
      let bd = -1;
      for (const s of sp) {
        let md = 1e9;
        for (const o of this.tanks) if (o !== t && o.alive) md = Math.min(md, Math.hypot(o.x - s.x, o.z - s.z));
        if (md > bd) { bd = md; best = s; }
      }
    }
    const jitter = initial ? 0 : 6;
    t.x = best.x + (Math.random() - 0.5) * jitter;
    t.z = best.z + (Math.random() - 0.5) * jitter;
    t.y = this.world.heightAt(t.x, t.z);
    t.yaw = Math.atan2(-t.x, -t.z);
    t.turretYaw = t.aimYaw = t.yaw;
    t.speed = 0; t.vx = 0; t.vz = 0;
    t.hp = t.maxHp;
    t.alive = true;
    t.invulnT = initial ? 0 : 2.5;
    t.burnT = 0;
    t.pitchMem = {};
    const lob = WEAPONS[t.def.weapons[0]].kind === 'lob';
    t.pitch = t.aimPitch = clamp(lob ? 0.6 : 0.05, t.def.pitchMin, t.def.pitchMax);
    t.weapons = t.def.weapons.map((id) => ({ id, ammo: Math.round(WEAPONS[id].maxAmmo * (initial ? 1 : 0.75)) }));
    t.wi = 0;
    for (const k in t.power) t.power[k] = 0;
    t.shieldHp = 0;
    this.world.normalAt(t.x, t.z, t.n);
    if (!initial) {
      this.fx.add({ k: 'shock', x: t.x, y: t.y + 0.3, z: t.z, life: 0.6, s0: 6, s1: 0.5, c0: t.color, a: 0.9 });
      this.sfx('respawn', t.x, t.z, 0.8);
    }
  }

  initPickups() {
    this.pickups = this.world.pickupSpots.map((s, i) => {
      const p = { x: s.x, z: s.z, y: this.world.heightAt(s.x, s.z), active: false, respawnT: 0, kind: 'health', sub: null, spin: Math.random() * 6, airdrop: false };
      this.rollPickup(p, i);
      p.active = this.cfg.pickups;
      return p;
    });
  }

  /** Pick what a pickup spot offers. Initial spots cycle through all kinds so every type is on the map. */
  rollPickup(p, i = -1) {
    const kinds = ['health', 'ammo', 'weapon', 'power'];
    if (i >= 0) p.kind = kinds[i % 4];
    else {
      const x = Math.random();
      p.kind = x < 0.3 ? 'health' : x < 0.58 ? 'ammo' : x < 0.78 ? 'weapon' : 'power';
    }
    if (!this.cfg.powerups && p.kind === 'power') p.kind = 'health';
    p.sub = p.kind === 'power' ? POWERUP_ORDER[Math.floor(Math.random() * POWERUP_ORDER.length)] : p.kind === 'weapon' ? CRATE_WEAPONS[Math.floor(Math.random() * CRATE_WEAPONS.length)] : null;
  }

  // ---------------- main loop ----------------
  frame(nowMs) {
    const now = nowMs / 1000;
    let dt = this.lastNow ? now - this.lastNow : DT;
    this.lastNow = now;
    if (dt > 0.25) dt = 0.25;
    this.frameMs = lerp(this.frameMs, dt * 1000, 0.05);
    this.fps = 1000 / this.frameMs;
    this.realTime += dt;
    this.input.pollPads();
    this.handleGlobalKeys();
    if (this.state !== 'paused') {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= DT && steps < 5) { this.step(DT); this.acc -= DT; steps++; }
      if (steps === 5) this.acc = 0;
      this.steppedThisFrame = steps > 0;
    }
    this.render(dt);
    this.input.endFrame(this.steppedThisFrame || this.state === 'paused' || this.state === 'over');
  }

  handleGlobalKeys() {
    const I = this.input;
    this.steppedThisFrame = false;
    if (I.anyKey && !this.audioStarted) { this.audioStarted = true; this.sound.init(); }
    if (I.wasPressed('Backquote')) this.sound.setMuted(!this.sound.muted);
    if ((I.wasPressed('Escape') || I.wasPressed('KeyP') || I.takePadPressed(0, 9)) && (this.state === 'play' || this.state === 'paused' || this.state === 'countdown')) {
      if (this.state === 'paused') this.state = this.pausedFrom || 'play';
      else { this.pausedFrom = this.state; this.state = 'paused'; I.releaseLock(); this.sound.stopEngines(); }
    }
    if (this.state === 'over' && this.overT > 2.5 && (I.wasPressed('Enter') || I.wasPressed('KeyG') || I.wasPressed('Space') || I.takePadPressed(0, 9))) this.restart();
    if (I.wasPressed('F2') || I.wasPressed('KeyX')) this.cfg.debug = !this.cfg.debug;
  }

  restart() {
    this.projectiles = []; this.mines = []; this.beams = []; this.debris = []; this.drops = []; this.killfeed = []; this.announce = []; this.events = [];
    this.fx.parts = []; this.fx.decals = []; this.fx.texts = []; this.fx.tracks = [];
    for (const o of this.world.obstacles) if (o.kind === 'bush' || o.kind === 'crate' || o.kind === 'barrel' || o.kind === 'fence') { o.alive = true; o.hp = o.kind === 'crate' ? 30 : o.kind === 'barrel' ? 15 : 1; o.squash = 0; }
    this.world.buildNav();
    this.initPickups();
    this.winner = null; this.firstBlood = false; this.dropT = this.cfg.airdrop;
    this.startMatch();
  }

  /** Run fn after `delay` seconds of simulation time. */
  later(delay, fn) { this.events.push({ t: this.time + delay, fn }); }

  step(dt) {
    this.time += dt;
    if (this.events.length) {
      const due = this.events.filter((e) => e.t <= this.time);
      if (due.length) { this.events = this.events.filter((e) => e.t > this.time); for (const e of due) e.fn(); }
    }
    this.world.updateAmbient(dt, this.time);
    this.fx.update(dt);
    this.shake = Math.max(0, this.shake - dt * 2.2);
    if (this.state === 'lobby') { this.updateLobby(dt); return; }
    if (this.state === 'countdown') {
      this.countdown -= dt;
      const c = Math.ceil(this.countdown - 0.5);
      if (c !== this.lastCount && c >= 1 && c <= 3) { this.sound.play('count', 0.8); this.lastCount = c; }
      if (this.countdown <= 0.5) { this.state = 'play'; this.sound.play('go', 0.8); this.announce.push({ text: 'GO!', t: 0, big: true }); }
    }
    const playing = this.state === 'play';
    if (playing) this.matchTime += dt;
    // controls
    for (const t of this.tanks) {
      if (!t.alive) continue;
      let c;
      if (t.human) c = this.humanControls(t, dt);
      else c = this.bots.find((b) => b.t === t).update(dt);
      if (!playing) { c = { ...c, throttle: 0, turn: 0, fire: false, dropMine: false }; }
      this.driveTank(t, c, dt);
    }
    for (const t of this.tanks) this.updateTank(t, dt);
    this.collideTanks(dt);
    this.updateProjectiles(dt);
    this.updateMines(dt);
    this.updatePickups(dt);
    this.updateDebris(dt);
    for (let i = this.beams.length - 1; i >= 0; i--) { this.beams[i].age += dt; if (this.beams[i].age > 0.5) this.beams.splice(i, 1); }
    for (const k of this.killfeed) k.t += dt;
    this.killfeed = this.killfeed.filter((k) => k.t < 6);
    for (const a of this.announce) a.t += dt;
    this.announce = this.announce.filter((a) => a.t < 2.2);
    if (playing) this.checkWin();
    if (this.state === 'over') this.overT += dt;
  }

  updateLobby(dt) {
    const I = this.input;
    for (const s of this.slots) {
      if (!s.joined && I.joinPressed(s.slot)) { s.joined = true; s.human = true; this.sound.init(); this.audioStarted = true; this.sound.play('pickup', 0.7); }
      if (s.joined) {
        const k = KEYMAPS[s.slot];
        let d = 0;
        if (I.takePressed(k.left) || I.takePadPressed(s.slot, 14)) d = -1;
        if (I.takePressed(k.right) || I.takePadPressed(s.slot, 15)) d = 1;
        if (d) {
          const i = TANK_ORDER.indexOf(s.type);
          s.type = TANK_ORDER[(i + d + TANK_ORDER.length) % TANK_ORDER.length];
          this.sound.play('switch', 0.6);
        }
        if (I.takePressed(k.down) && s.slot > 0) { s.joined = false; s.human = false; }
      }
    }
    if (this.lobbyT > 0) this.lobbyT -= dt;
    const go = I.takePressed(['KeyG']) || [0, 1, 2, 3].some((i) => I.takePadPressed(i, 9));
    if (go || (this.cfg.lobbyTimeout > 0 && this.lobbyT <= 0)) { this.sound.init(); this.audioStarted = true; this.startMatch(); }
  }

  // ---------------- controls ----------------
  humanControls(t, dt) {
    const raw = this.input.player(t.slot);
    if (raw.cycle) this.cycleWeapon(t);
    const c = { throttle: raw.throttle, turn: raw.turn, fire: raw.fire, aimYaw: t.aimYaw, aimPitch: t.aimPitch, weaponCycle: false };
    const def = t.def;
    const commander = this.cfg.mode === 'commander';
    const ms = this.input.mouse;
    // keyboard/stick aiming takes over from the mouse until the mouse actually moves again
    if (raw.keyTurret) { t.mouseAim = false; t.mouseBlock = ms.moved; }
    c.aimYaw += raw.turretRate * def.turret * 1.05 * dt;
    c.aimPitch += raw.pitchRate * def.pitchSpeed * dt;
    // mouse (player 1)
    if (t.slot === 0 && this.cfg.mouse) {
      if (commander) {
        if (ms.clicked && !ms.locked) { this.input.requestLock(); ms.clicked = false; }
        if (ms.locked) {
          const zoomK = t.zoom ? 1 / def.zoom : 1;
          c.aimYaw -= ms.dx * 0.0025 * zoomK;
          c.aimPitch -= ms.dy * 0.0022 * zoomK;
          ms.dx = 0; ms.dy = 0; // consumed by this sim step
          if (ms.buttons & 1) c.fire = true;
          if (ms.right) raw.zoom = true;
        }
      } else {
        if (ms.moved > (t.mouseBlock ?? -1e9) && performance.now() - ms.moved < 2500 && !raw.keyTurret) t.mouseAim = true;
        const cam = this.cams.find((v) => v.tank === t) || this.cams.find((v) => v.tanks && v.tanks.includes(t)) || this.cams[0];
        if (t.mouseAim && cam && ms.x >= cam.x && ms.x <= cam.x + cam.w && ms.y >= cam.y && ms.y <= cam.y + cam.h) {
          const hit = this.pickGround(cam, ms.x, ms.y);
          if (hit) {
            const dx = hit[0] - t.x, dz = hit[2] - t.z;
            c.aimYaw = Math.atan2(dx, dz);
            t.mouseTarget = hit;
            const W = WEAPONS[t.weapons[t.wi].id];
            const d = Math.hypot(dx, dz);
            if (W.kind === 'lob') {
              c.aimPitch = ballisticPitch(W.speed, W.gravity, d, hit[1] - (t.y + 1.8), true);
              if (c.aimPitch > def.pitchMax) c.aimPitch = ballisticPitch(W.speed, W.gravity, d, hit[1] - (t.y + 1.8), false);
            }
            else if (W.kind === 'shell') c.aimPitch = ballisticPitch(W.speed, W.gravity, d, hit[1] + 1 - (t.y + 1.8), false);
            else c.aimPitch = Math.atan2(hit[1] + 1 - (t.y + 1.8), d);
          }
        }
        if (ms.buttons & 1) c.fire = true;
      }
      if (ms.wheel) { this.cycleWeapon(t); c.aimPitch = t.aimPitch; ms.wheel = 0; }
    }
    t.zoom = raw.zoom;
    // keep aim close to the actual turret so keyboard traverse doesn't wind up
    const lim = 0.6;
    const d = wrapAngle(c.aimYaw - t.turretYaw);
    const mouseLook = commander && t.slot === 0 && ms.locked;
    if (Math.abs(d) > lim && !t.mouseAim && !mouseLook) c.aimYaw = t.turretYaw + Math.sign(d) * lim;
    if (mouseLook && Math.abs(d) > 2.6) c.aimYaw = t.turretYaw + Math.sign(d) * 2.6;
    c.aimPitch = clamp(c.aimPitch, def.pitchMin, def.pitchMax);
    return c;
  }

  /** Ray from screen point onto terrain. */
  pickGround(cam, sx, sy) {
    if (!cam.invVP) return null;
    const nx = ((sx - cam.x) / cam.w) * 2 - 1, ny = -(((sy - cam.y) / cam.h) * 2 - 1);
    const a = m4.transform(cam.invVP, nx, ny, -1, 1), b = m4.transform(cam.invVP, nx, ny, 1, 1);
    const o = [a[0] / a[3], a[1] / a[3], a[2] / a[3]], e = [b[0] / b[3], b[1] / b[3], b[2] / b[3]];
    const d = [e[0] - o[0], e[1] - o[1], e[2] - o[2]];
    const L = Math.hypot(...d); d[0] /= L; d[1] /= L; d[2] /= L;
    let prev = 0;
    for (let s = 1; s < 800; s += 2) {
      const x = o[0] + d[0] * s, y = o[1] + d[1] * s, z = o[2] + d[2] * s;
      if (y < this.world.heightAt(x, z)) {
        let lo = prev, hi = s;
        for (let k = 0; k < 8; k++) {
          const mid = (lo + hi) / 2;
          if (o[1] + d[1] * mid < this.world.heightAt(o[0] + d[0] * mid, o[2] + d[2] * mid)) hi = mid; else lo = mid;
        }
        return [o[0] + d[0] * hi, o[1] + d[1] * hi, o[2] + d[2] * hi];
      }
      prev = s;
    }
    return null;
  }

  // ---------------- tanks ----------------
  driveTank(t, c, dt) {
    const def = t.def, W = this.world;
    const sp = t.power.speed > 0 ? 1.55 : 1;
    // weapon selection
    if (c.weaponCycle) this.cycleWeapon(t);
    if (c.weapon && t.weapons[t.wi].id !== c.weapon) {
      const i = t.weapons.findIndex((w) => w.id === c.weapon);
      if (i >= 0) { t.wi = i; t.cooldown = Math.min(t.cooldown, 0.25); }
    }
    // throttle with slope effect
    const fx = Math.sin(t.yaw), fz = Math.cos(t.yaw);
    const L = 1.8 * t.scale;
    const slope = (W.heightAt(t.x + fx * L, t.z + fz * L) - W.heightAt(t.x - fx * L, t.z - fz * L)) / (2 * L);
    let target = c.throttle > 0 ? c.throttle * def.speed * sp : c.throttle * def.reverse * sp;
    target *= 1 - clamp(slope * Math.sign(target || 1) * 1.2, -0.25, 0.65);
    const accel = (Math.sign(target) !== Math.sign(t.speed) && Math.abs(t.speed) > 0.5 ? 2.2 : 1) * def.accel * (c.throttle === 0 ? 0.8 : 1);
    t.speed += clamp(target - t.speed, -accel * dt, accel * dt);
    // steering (a bit slower at top speed)
    const turnMul = 1 - Math.min(Math.abs(t.speed) / (def.speed * 2.5), 0.3);
    const dyaw = c.turn * def.turn * turnMul * dt;
    t.yaw = wrapAngle(t.yaw + dyaw);
    if (!this.cfg.stabilizer && t.human) c.aimYaw += dyaw;
    // turret: world-stabilised aim, traversing at the type's turret speed
    t.aimYaw = c.aimYaw;
    t.aimPitch = clamp(c.aimPitch, def.pitchMin, def.pitchMax);
    const tmul = t.human ? 1 : (this.bots.find((b) => b.t === t)?.d.turretMul || 1);
    t.turretYaw = approachAngle(t.turretYaw, t.aimYaw, def.turret * tmul * dt);
    t.turretYaw = wrapAngle(t.turretYaw);
    t.pitch += clamp(t.aimPitch - t.pitch, -def.pitchSpeed * dt, def.pitchSpeed * dt);
    // firing
    if (c.fire) this.fire(t);
    if (c.dropMine) { this.dropMine(t); c.dropMine = false; }
  }

  cycleWeapon(t) {
    t.cooldown = Math.min(t.cooldown, 0.25); // each gun has its own loader: a quick swap is ready almost at once
    // each weapon remembers its own barrel elevation (mortar high, MG flat)
    t.pitchMem = t.pitchMem || {};
    t.pitchMem[t.weapons[t.wi].id] = t.aimPitch;
    for (let k = 1; k <= t.weapons.length; k++) {
      const i = (t.wi + k) % t.weapons.length;
      if (t.weapons[i].ammo > 0 || k === t.weapons.length) { t.wi = i; break; }
    }
    const nw = WEAPONS[t.weapons[t.wi].id];
    const mem = t.pitchMem[nw.id];
    t.aimPitch = clamp(mem !== undefined ? mem : nw.kind === 'lob' ? 0.6 : 0.03, t.def.pitchMin, t.def.pitchMax);
    t.pendingPitch = t.aimPitch;
    if (t.human) this.sound.play('switch', 0.5);
  }

  updateTank(t, dt) {
    const W = this.world, def = t.def;
    t.flashT = Math.max(0, t.flashT - dt);
    t.recoil = Math.max(0, t.recoil - dt * 3);
    t.camKick = Math.max(0, t.camKick - dt * 4);
    t.cooldown -= dt;
    t.invulnT = Math.max(0, t.invulnT - dt);
    t.hitMarkT = Math.max(0, t.hitMarkT - dt);
    t.dmgT = Math.max(0, t.dmgT - dt);
    t.ramT = Math.max(0, t.ramT - dt);
    for (const k in t.power) if (t.power[k] > 0) { t.power[k] -= dt; if (t.power[k] <= 0) { t.power[k] = 0; if (k === 'shield') t.shieldHp = 0; } }
    if (!t.alive) {
      t.wreckT += dt;
      if (Math.random() < dt * 6) this.fx.smokeTrail(t.x + (Math.random() - 0.5) * 2, t.y + 1.5, t.z + (Math.random() - 0.5) * 2, 0.6, 0.35);
      if (Math.random() < dt * 4 && t.wreckT < 2) this.fx.fireTrail(t.x, t.y + 1.2, t.z, 1.2);
      if (!t.eliminated && this.state !== 'over') {
        t.respawnT -= dt;
        if (t.respawnT <= 0) this.spawnTank(t);
      }
      this.updateTankMatrices(t);
      return;
    }
    if (t.burnT > 0) {
      t.burnT -= dt;
      this.damage(t, 7 * dt, t.burnBy, null, 'burn', true);
      if (Math.random() < dt * 20) this.fx.flame(t.x + (Math.random() - 0.5) * 2, t.y + 1.2, t.z + (Math.random() - 0.5) * 2, 0, 2, 0);
      if (!t.alive) return;
    }
    // move with collision
    const ox = t.x, oz = t.z;
    const nx = t.x + Math.sin(t.yaw) * t.speed * dt, nz = t.z + Math.cos(t.yaw) * t.speed * dt;
    const blocked = (x, z) => W.isWater(x, z) || !W.inBounds(x, z);
    if (!blocked(nx, nz)) { t.x = nx; t.z = nz; }
    else if (!blocked(nx, t.z)) { t.x = nx; t.speed *= 0.9; }
    else if (!blocked(t.x, nz)) { t.z = nz; t.speed *= 0.9; }
    else t.speed *= -0.25;
    // obstacles
    W.query(t.x, t.z, t.radius, (o) => {
      if (o.soft) {
        if (o.kind === 'bush' || o.kind === 'fence') this.breakObstacle(o, t);
        return;
      }
      const dx = t.x - o.x, dz = t.z - o.z, d = Math.hypot(dx, dz) || 0.01;
      const pen = t.radius + o.r - d;
      if (pen <= 0) return;
      if ((o.kind === 'crate' || o.kind === 'barrel') && Math.abs(t.speed) > 7 && def.mass >= 1.0) {
        this.damageObstacle(o, 100, t);
        t.speed *= 0.7;
        return;
      }
      t.x += (dx / d) * pen; t.z += (dz / d) * pen;
      const fwdDot = -(dx / d) * Math.sin(t.yaw) - (dz / d) * Math.cos(t.yaw);
      if (fwdDot * Math.sign(t.speed) > 0.5 && Math.abs(t.speed) > 6 && t.ramT <= 0) {
        this.fx.impact(o.x - (dx / d) * o.r, t.y + 1, o.z - (dz / d) * o.r, [0.8, 0.7, 0.5], 4);
        if (o.kind === 'tree') this.fx.leaves(o.x, t.y + 4, o.z, [0.4, 0.75, 0.3], 8);
        this.sfx('ram', t.x, t.z, 0.4);
        t.ramT = 0.5;
      }
      t.speed *= 1 - clamp(fwdDot * Math.sign(t.speed), 0, 1) * 0.5;
    });
    t.vx = (t.x - ox) / dt; t.vz = (t.z - oz) / dt;
    // ground follow + tilt from terrain
    const fx = Math.sin(t.yaw), fz = Math.cos(t.yaw), rx = Math.cos(t.yaw), rz = -Math.sin(t.yaw);
    const L = 1.7 * t.scale, Wd = 1.1 * t.scale;
    const hF = W.heightAt(t.x + fx * L, t.z + fz * L), hB = W.heightAt(t.x - fx * L, t.z - fz * L);
    const hR = W.heightAt(t.x + rx * Wd, t.z + rz * Wd), hL = W.heightAt(t.x - rx * Wd, t.z - rz * Wd);
    const df = (hF - hB) / (2 * L), dr = (hR - hL) / (2 * Wd);
    let n0 = -df * fx - dr * rx, n1 = 1, n2 = -df * fz - dr * rz;
    const nl = Math.hypot(n0, n1, n2);
    const k = Math.min(1, dt * 10);
    t.n[0] = lerp(t.n[0], n0 / nl, k); t.n[1] = lerp(t.n[1], n1 / nl, k); t.n[2] = lerp(t.n[2], n2 / nl, k);
    const ln = Math.hypot(t.n[0], t.n[1], t.n[2]); t.n[0] /= ln; t.n[1] /= ln; t.n[2] /= ln;
    const gy = Math.max((hF + hB + hR + hL) / 4, W.heightAt(t.x, t.z));
    t.y = lerp(t.y, gy, Math.min(1, dt * 15));
    // track marks & dust
    const moved = Math.hypot(t.x - ox, t.z - oz);
    t.trackAcc += moved;
    if (t.trackAcc > 0.55) {
      t.trackAcc = 0;
      const tw = 1.0 * t.scale;
      this.fx.trackMark(t.x + rx * tw, t.z + rz * tw, t.yaw, 0.5 * t.scale);
      this.fx.trackMark(t.x - rx * tw, t.z - rz * tw, t.yaw, 0.5 * t.scale);
      if (Math.abs(t.speed) > def.speed * 0.6 && Math.random() < 0.5) this.fx.dust(t.x - fx * L * 1.2, t.y, t.z - fz * L * 1.2, 1);
    }
    this.updateTankMatrices(t);
    // engine sound for humans
    if (t.human) {
      const [vol, pan] = this.spatial(t.x, t.z);
      this.sound.engine(t.id, this.state !== 'paused' && this.state !== 'over', Math.min(1, Math.hypot(t.vx, t.vz) / def.speed), vol * 0.9, pan);
    }
  }

  updateTankMatrices(t) {
    const s = t.scale, G = t.geom;
    alignToNormal(t.hullM, t.x, t.y, t.z, t.n, t.yaw, s);
    m4.compose(this.m, 0, G.turretY, 0, t.turretYaw - t.yaw);
    m4.multiply(t.turretM, t.hullM, this.m);
    m4.compose(this.m, 0, G.barrelY, G.barrelZ - t.recoil * 0.6, 0, -t.pitch, 0);
    m4.multiply(t.barrelM, t.turretM, this.m);
    const b = t.barrelM;
    const L = G.barrelLen;
    t.muzzle[0] = b[12] + b[8] * L; t.muzzle[1] = b[13] + b[9] * L; t.muzzle[2] = b[14] + b[10] * L;
    // the gun is stabilised in both axes: firing direction ignores hull tilt so aim math stays exact
    dirFromYawPitch(t.turretYaw, t.pitch, t.dir);
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
      // ramming damage: relative closing speed along the normal
      const rel = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
      if (rel > 6 && a.ramT <= 0 && b.ramT <= 0) {
        const va = a.vx * nx + a.vz * nz, vb = -(b.vx * nx + b.vz * nz);
        const atk = va > vb ? a : b, vic = atk === a ? b : a;
        const dmg = rel * 1.3 * atk.def.mass * (atk.def.id === 'bulldog' ? 1.8 : 1);
        this.damage(vic, dmg, atk, [nx * (atk === a ? 1 : -1), 0, nz * (atk === a ? 1 : -1)], 'ram');
        this.damage(atk, dmg * 0.25 / atk.def.mass, vic, null, 'ram');
        a.ramT = b.ramT = 0.6;
        this.fx.impact((a.x + b.x) / 2, (a.y + b.y) / 2 + 1, (a.z + b.z) / 2, [1, 0.8, 0.4], 12);
        this.sfx('ram', a.x, a.z, 1);
        this.shake = Math.max(this.shake, 0.3);
        vic.speed += (atk.speed - vic.speed) * 0.3;
        atk.speed *= 0.5;
      }
    }
  }

  // ---------------- weapons ----------------
  fire(t) {
    if (t.cooldown > 0 || !t.alive) return;
    const w = t.weapons[t.wi];
    const W = WEAPONS[w.id];
    if (w.ammo <= 0) {
      t.cooldown = 0.3;
      if (t.human) this.sound.play('empty', 0.5);
      this.cycleWeapon(t);
      return;
    }
    if (W.kind === 'mine') { this.dropMine(t); return; }
    w.ammo--;
    t.stats.shots++;
    t.cooldown = W.reload * (t.power.rapid > 0 ? 0.5 : 1);
    t.recoil = Math.min(1, t.recoil + W.recoil);
    t.camKick = W.recoil;
    const [mx, my, mz] = t.muzzle;
    let [dx, dy, dz] = t.dir;
    if (W.spread) {
      dx += (Math.random() - 0.5) * W.spread * 2; dy += (Math.random() - 0.5) * W.spread; dz += (Math.random() - 0.5) * W.spread * 2;
      const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
    }
    const dmgMul = t.power.damage > 0 ? 2 : 1;
    if (t.human) this.shake = Math.max(this.shake, W.shake * (this.cfg.mode === 'commander' ? 0.5 : 1));
    if (W.kind === 'rail') { this.fireRail(t, W, dmgMul); return; }
    if (W.kind === 'flame') {
      const v = W.speed * (0.85 + Math.random() * 0.3);
      this.projectiles.push({ kind: 'flame', owner: t, x: mx, y: my, z: mz, vx: dx * v + t.vx, vy: dy * v + 1, vz: dz * v + t.vz, g: -2, dmg: W.dmg * dmgMul, life: W.range / W.speed, age: 0, W, hitSet: new Set() });
      this.fx.flame(mx, my, mz, dx * v + t.vx, dy * v + 1, dz * v + t.vz);
      this.sfx('flame', mx, mz, 0.6);
      return;
    }
    const v = W.speed;
    const p = { kind: W.kind, owner: t, x: mx, y: my, z: mz, vx: dx * v, vy: dy * v, vz: dz * v, g: W.gravity || 0, dmg: W.dmg * dmgMul, splash: W.splash || 0, splashDmg: (W.splashDmg || 0) * dmgMul, life: W.kind === 'bullet' ? W.range / v : 8, age: 0, W, whistled: false };
    if (W.kind === 'rocket') {
      const skill = t.human ? 1 : (this.bots.find((b) => b.t === t)?.d.homing ?? 1);
      p.target = this.lockTarget(t, 0.25 + 0.2 * skill, 140);
      p.homing = p.W.homing * skill;
      p.life = 4;
      p.vx = dx * v * 0.5; p.vy = dy * v * 0.5 + 1.5; p.vz = dz * v * 0.5;
    }
    this.projectiles.push(p);
    const big = W.kind === 'shell' || W.kind === 'lob' ? (W.size || 1) * 1.2 : W.kind === 'rocket' ? 0.6 : 0.35;
    const off = t.human && this.cfg.mode === 'commander' ? 2.2 : 0; // keep the flash out of the gunner's face
    this.fx.muzzle(mx + dx * off, my + dy * off, mz + dz * off, dx, dy, dz, off ? big * 0.6 : big, W.color, !off);
    if (W.kind === 'shell' || W.kind === 'lob') {
      // kick up dust around the tank
      for (let i = 0; i < 4; i++) this.fx.dust(t.x + (Math.random() - 0.5) * 3, t.y, t.z + (Math.random() - 0.5) * 3, 1);
    }
    this.sfx(w.id === 'bigcannon' ? 'bigcannon' : W.kind === 'shell' ? 'cannon' : W.kind === 'lob' ? 'mortar' : W.kind === 'rocket' ? 'rockets' : 'mg', mx, mz, t.human ? 1 : 0.8);
  }

  lockTarget(t, cone, range) {
    let best = null, bs = 1e9;
    for (const e of this.tanks) {
      if (e === t || !e.alive || e.power.ghost > 0) continue;
      const dx = e.x - t.x, dz = e.z - t.z, d = Math.hypot(dx, dz);
      if (d > range) continue;
      const a = Math.abs(wrapAngle(Math.atan2(dx, dz) - t.turretYaw));
      if (a > cone) continue;
      const s = a * 60 + d;
      if (s < bs) { bs = s; best = e; }
    }
    return best;
  }

  fireRail(t, W, dmgMul) {
    const [mx, my, mz] = t.muzzle, [dx, dy, dz] = t.dir;
    let end = W.range;
    const hits = [];
    for (let s = 0; s < W.range; s += 0.8) {
      const x = mx + dx * s, y = my + dy * s, z = mz + dz * s;
      if (y < this.world.heightAt(x, z)) { end = s; break; }
      let stop = false;
      this.world.query(x, z, 0.2, (o) => { if (!o.soft && y < o.top) { stop = true; if (o.hp) this.damageObstacle(o, W.dmg, t); return false; } });
      if (stop) { end = s; break; }
      for (const e of this.tanks) {
        if (e === t || !e.alive || hits.includes(e)) continue;
        if (Math.hypot(e.x - x, e.z - z) < e.radius * 1.05 && y > e.y - 0.3 && y < e.y + 2.6 * e.scale) hits.push(e);
      }
    }
    for (const e of hits) { this.damage(e, W.dmg * dmgMul, t, [dx, 0, dz], 'rail'); this.fx.impact(e.x, e.y + 1.5, e.z, [0.5, 1, 1], 14); }
    const ex = mx + dx * end, ey = my + dy * end, ez = mz + dz * end;
    this.beams.push({ x: mx, y: my, z: mz, ex, ey, ez, age: 0, col: [0.4, 1, 1] });
    this.fx.impact(ex, ey, ez, [0.5, 1, 1], 10);
    this.fx.muzzle(mx, my, mz, dx, dy, dz, 1, [0.4, 1, 1]);
    this.sfx('rail', mx, mz, 1);
  }

  dropMine(t) {
    const w = t.weapons.find((x) => x.id === 'mines');
    if (!w || w.ammo <= 0 || t.mineCd > this.time) return;
    w.ammo--;
    t.mineCd = this.time + WEAPONS.mines.reload;
    t.cooldown = Math.max(t.cooldown, 0.2);
    const bx = t.x - Math.sin(t.yaw) * (t.radius + 1.5), bz = t.z - Math.cos(t.yaw) * (t.radius + 1.5);
    const mine = this.mines.filter((m) => m.owner === t);
    if (mine.length >= 6) this.mines.splice(this.mines.indexOf(mine[0]), 1);
    this.mines.push({ x: bx, z: bz, y: this.world.heightAt(bx, bz), owner: t, armT: WEAPONS.mines.armTime, life: WEAPONS.mines.life, dmg: WEAPONS.mines.dmg * (t.power.damage > 0 ? 2 : 1), blink: 0 });
    this.sfx('mine', bx, bz, 0.7);
  }

  updateMines(dt) {
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i];
      m.armT -= dt; m.life -= dt; m.blink += dt;
      if (m.life <= 0) { this.mines.splice(i, 1); this.fx.impact(m.x, m.y + 0.3, m.z, [1, 0.3, 0.3], 4); continue; }
      if (m.armT > 0) continue;
      let trig = false;
      for (const t of this.tanks) if (t.alive && t !== m.owner && Math.hypot(t.x - m.x, t.z - m.z) < t.radius + 1.4) trig = true;
      if (trig) {
        this.mines.splice(i, 1);
        this.explodeAt(m.x, m.y + 0.4, m.z, m.owner, m.dmg, WEAPONS.mines.splash, WEAPONS.mines.splashDmg, 1.6, null, 'mine');
      }
    }
  }

  updateProjectiles(dt) {
    const W = this.world;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.age += dt;
      if (p.age > p.life) {
        if (p.kind === 'rocket') this.explodeAt(p.x, p.y, p.z, p.owner, p.dmg * 0.5, p.splash, p.splashDmg, 0.8, null, 'rocket');
        this.projectiles.splice(i, 1);
        continue;
      }
      if (p.kind === 'rocket') {
        const sp = Math.min(p.W.speed, Math.hypot(p.vx, p.vy, p.vz) + 80 * dt);
        let dx = p.vx, dy = p.vy, dz = p.vz;
        if (p.target && p.target.alive && p.age > 0.15) {
          const tx = p.target.x - p.x, ty = p.target.y + 1.2 - p.y, tz = p.target.z - p.z, tl = Math.hypot(tx, ty, tz);
          const cl = Math.hypot(dx, dy, dz) || 1;
          const k = (p.homing ?? p.W.homing) * dt;
          dx = dx / cl + (tx / tl) * k; dy = dy / cl + (ty / tl) * k; dz = dz / cl + (tz / tl) * k;
        }
        const l = Math.hypot(dx, dy, dz) || 1;
        p.vx = (dx / l) * sp; p.vy = (dy / l) * sp; p.vz = (dz / l) * sp;
        if (Math.random() < 0.9) this.fx.smokeTrail(p.x, p.y, p.z, 0.3, 0.9);
        this.fx.fireTrail(p.x, p.y, p.z, 0.35);
      }
      if (p.kind === 'flame') { const d = Math.exp(-1.5 * dt); p.vx *= d; p.vz *= d; }
      p.vy -= p.g * dt;
      if ((p.kind === 'lob' || p.kind === 'shell') && Math.random() < 0.5) this.fx.smokeTrail(p.x, p.y, p.z, p.kind === 'lob' ? 0.35 : 0.2, 0.85);
      if (p.kind === 'lob' && !p.whistled && p.vy < -5) { p.whistled = true; this.sfx('whistle', p.x, p.z, 0.7, { dur: Math.min(1.5, Math.max(0.4, (p.y - W.heightAt(p.x, p.z)) / 30)) }); }
      const steps = Math.max(1, Math.ceil((Math.hypot(p.vx, p.vy, p.vz) * dt) / 1.2));
      let done = false;
      for (let s = 0; s < steps && !done; s++) {
        p.x += (p.vx * dt) / steps; p.y += (p.vy * dt) / steps; p.z += (p.vz * dt) / steps;
        done = this.projectileHit(p);
      }
      if (done) this.projectiles.splice(i, 1);
    }
  }

  /** Returns true when the projectile is consumed. */
  projectileHit(p) {
    const W = this.world;
    if (!W.inBounds(p.x, p.z, -20)) return true;
    // tanks
    for (const t of this.tanks) {
      if (!t.alive || (t === p.owner && p.age < 0.4)) continue;
      if (p.kind === 'flame' && (t === p.owner || p.hitSet.has(t))) continue;
      const r = t.radius * (p.kind === 'flame' ? 1.4 : 1.0);
      if (Math.hypot(t.x - p.x, t.z - p.z) < r && p.y > t.y - 0.4 && p.y < t.y + 2.6 * t.scale) {
        if (p.kind === 'flame') {
          p.hitSet.add(t);
          this.damage(t, p.dmg, p.owner, null, 'flame');
          if (t.power.shield <= 0) { t.burnT = Math.max(t.burnT, p.W.burn); t.burnBy = p.owner; }
          return false;
        }
        const dir = [p.vx, 0, p.vz];
        this.damage(t, p.dmg, p.owner, dir, p.kind);
        if (p.splash) this.explodeAt(p.x, p.y, p.z, p.owner, 0, p.splash, p.splashDmg, p.kind === 'lob' ? 1.8 : (p.W.size || 1), t, p.kind);
        else { this.fx.impact(p.x, p.y, p.z, [1, 0.9, 0.5], 5); this.sfx('ping', p.x, p.z, 0.5); }
        return true;
      }
    }
    // obstacles
    let hitO = null;
    W.query(p.x, p.z, 0.2, (o) => {
      if (p.y > o.top) return;
      if (o.soft && (p.kind === 'bullet' || p.kind === 'flame')) { if (o.kind === 'bush' && p.kind === 'flame') this.breakObstacle(o, p.owner); return; }
      hitO = o; return false;
    });
    if (hitO) {
      if (p.kind === 'flame') return true;
      if (hitO.hp) this.damageObstacle(hitO, p.kind === 'bullet' ? p.dmg : p.dmg + (p.splashDmg || 0), p.owner);
      if (hitO.kind === 'tree') this.fx.leaves(hitO.x, Math.min(p.y + 2, hitO.top), hitO.z, [0.4, 0.75, 0.3], p.kind === 'bullet' ? 2 : 8);
      if (p.splash) this.explodeAt(p.x, p.y, p.z, p.owner, 0, p.splash, p.splashDmg, p.kind === 'lob' ? 1.6 : (p.W.size || 1) * 0.9, null, p.kind);
      else { this.fx.impact(p.x, p.y, p.z, [1, 0.85, 0.5], 4); this.sfx('ping', p.x, p.z, 0.25); }
      return true;
    }
    // ground / water
    const gh = W.heightAt(p.x, p.z);
    if (p.y < gh) {
      if (p.kind === 'flame') return true;
      if (gh < WATER_LEVEL && p.y < WATER_LEVEL + 0.1) {
        this.fx.splash(p.x, p.z, p.splash ? 1.4 : 0.5);
        this.sfx('splash', p.x, p.z, p.splash ? 0.8 : 0.3);
        return true;
      }
      if (p.splash) this.explodeAt(p.x, gh + 0.2, p.z, p.owner, 0, p.splash, p.splashDmg, p.kind === 'lob' ? 1.8 : (p.W.size || 1) * 0.9, null, p.kind);
      else this.fx.dust(p.x, gh, p.z, 2);
      return true;
    }
    if (gh < WATER_LEVEL && p.y < WATER_LEVEL) { this.fx.splash(p.x, p.z, p.splash ? 1.4 : 0.5); this.sfx('splash', p.x, p.z, 0.4); return true; }
    return false;
  }

  /** Explosion with splash damage, scenery destruction and chain reactions. */
  explodeAt(x, y, z, owner, directDmg, radius, splashDmg, size, exclude = null, cause = 'blast') {
    this.fx.explode(x, y, z, size);
    this.sfx('explosion', x, z, Math.min(1.3, 0.6 + size * 0.3), { size });
    this.shakeAt(x, z, 0.25 * size + 0.1);
    if (directDmg > 0) {
      // the closest tank inside the blast takes the direct hit (mines, rockets that time out)
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
        // knockback
        t.speed *= 0.6;
      }
    }
    this.world.query(x, z, radius * 0.8, (o) => {
      if (o.hp || o.kind === 'bush' || o.kind === 'fence') this.damageObstacle(o, splashDmg + 20, owner);
    });
  }

  breakObstacle(o, by) {
    if (!o.alive) return;
    o.alive = false;
    if (o.kind === 'bush') {
      this.fx.leaves(o.x, o.y + 0.5, o.z, o.col, 12);
      this.sfx('bush', o.x, o.z, 0.5);
    } else if (o.kind === 'fence') {
      this.fx.leaves(o.x, o.top - 0.8, o.z, [0.85, 0.75, 0.6], 8);
      this.sfx('crate', o.x, o.z, 0.4);
    }
  }

  damageObstacle(o, dmg, by) {
    if (!o.alive) return;
    if (o.kind === 'bush' || o.kind === 'fence') { this.breakObstacle(o, by); return; }
    if (!o.hp) return;
    o.hp -= dmg;
    if (o.hp > 0) return;
    o.alive = false;
    if (o.kind === 'crate') {
      this.fx.leaves(o.x, o.y + 1, o.z, [0.78, 0.55, 0.3], 14);
      this.fx.impact(o.x, o.y + 1, o.z, [1, 0.8, 0.5], 6);
      this.sfx('crate', o.x, o.z, 0.8);
      // crates sometimes hide goodies
      if (Math.random() < 0.45 && this.cfg.pickups) {
        const p = { x: o.x, z: o.z, y: this.world.heightAt(o.x, o.z), active: true, respawnT: 0, spin: 0, temp: 20, kind: 'ammo', sub: null };
        this.rollPickup(p);
        this.pickups.push(p);
      }
    } else if (o.kind === 'barrel') {
      // chain reaction!
      this.later(0.06 + Math.random() * 0.09, () => this.explodeAt(o.x, o.y + 0.8, o.z, by, 0, 7, 40, 2.2, null, 'barrel'));
    }
    this.world.refreshNavAround(o.x, o.z, 6);
  }

  damage(t, amount, by, dir, cause, silent = false) {
    if (!t.alive || amount <= 0 || this.state === 'over') return;
    if (t.invulnT > 0) return;
    if (this.state !== 'play' && this.state !== 'paused') return;
    let a = amount * t.def.armor;
    if (t.shieldHp > 0) {
      const ab = Math.min(t.shieldHp, a);
      t.shieldHp -= ab; a -= ab;
      if (!silent) this.sfx('shieldHit', t.x, t.z, 0.6);
      if (t.shieldHp <= 0) t.power.shield = 0;
    }
    if (a <= 0) return;
    t.hp -= a;
    if (!silent && (a >= 5 || Math.random() < 0.15)) t.flashT = 0.1;
    if (by && by !== t) {
      t.lastHitBy = by; t.lastHitT = this.time;
      by.stats.dmg += a;
      if (!silent) { by.hitMarkT = 0.25; by.stats.hits++; }
    }
    if (dir) { t.dmgDir = Math.atan2(-dir[0], -dir[2]); t.dmgT = 1.0; }
    if (!silent) {
      this.sfx('hit', t.x, t.z, 0.7);
      this.fx.texts.push({ x: t.x + (Math.random() - 0.5) * 2, y: t.y + 3.5, z: t.z, text: '-' + Math.round(a), scale: 0.55, age: 0, life: 0.8, col: '#fff36b', rot: 0, small: true });
      if (this.fx.texts.length > 20) this.fx.texts.shift();
    }
    if (t.human && !silent) this.shake = Math.max(this.shake, Math.min(0.5, a / 60));
    if (t.hp <= 0) this.kill(t, by, cause);
  }

  kill(t, by, cause) {
    t.alive = false;
    t.hp = 0;
    t.deaths++;
    t.streak = 0;
    t.wreckT = 0;
    t.respawnT = this.cfg.respawn;
    t.speed = 0;
    t.burnT = 0;
    if (this.cfg.lives > 0) { t.lives--; if (t.lives <= 0) t.eliminated = true; }
    this.explodeAt(t.x, t.y + 1, t.z, by, 0, 6, 15, 2.6, t, 'chain');
    this.fx.explode(t.x, t.y + 2, t.z, 1.5, { debrisCol: t.color, text: ['KABOOM!', 'KA-BLAM!', 'BOOM!', 'WHAMMO!'][Math.floor(Math.random() * 4)] });
    this.shakeAt(t.x, t.z, 0.9);
    // turret pops off and tumbles
    const a = Math.random() * Math.PI * 2;
    this.debris.push({ type: t.def.id, x: t.turretM[12], y: t.turretM[13], z: t.turretM[14], vx: Math.cos(a) * 5, vy: 16 + Math.random() * 6, vz: Math.sin(a) * 5, yaw: t.turretYaw, pitch: 0, roll: 0, wy: (Math.random() - 0.5) * 8, wp: (Math.random() - 0.5) * 8, color: t.color, scale: t.scale, age: 0 });
    this.sfx('death', t.x, t.z, 0.6);
    let text;
    if (by && by !== t) {
      by.kills++; by.score++; by.streak++;
      const multi = this.time - by.lastKillT < 4;
      by.lastKillT = this.time;
      if (by.human) this.sound.play('kill', 0.6);
      if (!this.firstBlood) { this.firstBlood = true; this.announce.push({ text: 'FIRST BLOOD!', t: 0, col: by.css }); }
      else if (multi) this.announce.push({ text: 'DOUBLE KILL!', t: 0, col: by.css });
      else if (by.streak === 3) this.announce.push({ text: by.name + ' IS ON A ROLL!', t: 0, col: by.css });
      else if (by.streak === 5) this.announce.push({ text: by.name + ' IS UNSTOPPABLE!', t: 0, col: by.css });
      text = { a: by.name, ac: by.css, b: t.name, bc: t.css, w: cause };
    } else {
      t.score = Math.max(0, t.score - 1);
      text = { a: t.name, ac: t.css, b: 'self-destructed', bc: '#aaa', w: cause, self: true };
    }
    this.killfeed.push({ ...text, t: 0 });
    if (this.killfeed.length > 5) this.killfeed.shift();
  }

  updateDebris(dt) {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.age += dt;
      d.vy -= 26 * dt;
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      d.yaw += d.wy * dt; d.pitch += d.wp * dt;
      const g = this.world.heightAt(d.x, d.z);
      if (d.y < g + 0.3) {
        d.y = g + 0.3;
        if (d.vy < -4) { d.vy *= -0.4; d.vx *= 0.6; d.vz *= 0.6; this.fx.dust(d.x, g, d.z, 3); } else { d.vy = 0; d.vx *= 0.9; d.vz *= 0.9; d.wy *= 0.9; d.wp *= 0.9; }
      }
      if (Math.random() < dt * 12 && d.age < 3) this.fx.smokeTrail(d.x, d.y, d.z, 0.5, 0.3);
      if (d.age > 6) this.debris.splice(i, 1);
    }
  }

  // ---------------- pickups ----------------
  updatePickups(dt) {
    if (!this.cfg.pickups) return;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.spin += dt;
      if (p.temp !== undefined) { p.temp -= dt; if (p.temp <= 0) { this.pickups.splice(i, 1); continue; } }
      if (!p.active) {
        p.respawnT -= dt;
        if (p.respawnT <= 0) { this.rollPickup(p); p.active = true; this.fx.add({ k: 'shock', x: p.x, y: p.y + 0.3, z: p.z, life: 0.5, s0: 0.5, s1: 4, c0: [1, 1, 1], a: 0.7 }); }
        continue;
      }
      for (const t of this.tanks) {
        if (!t.alive || Math.hypot(t.x - p.x, t.z - p.z) > t.radius + 1.6) continue;
        if (this.collect(t, p)) {
          p.active = false;
          p.respawnT = PICKUP_KINDS[p.kind].respawn * (0.8 + Math.random() * 0.4);
          if (p.temp !== undefined || p.airdrop) { this.pickups.splice(i, 1); }
          break;
        }
      }
    }
    // airdrops
    if (this.cfg.airdrop > 0 && this.state === 'play') {
      this.dropT -= dt;
      if (this.dropT <= 0) { this.dropT = this.cfg.airdrop; this.spawnAirdrop(); }
    }
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.y -= dt * 6;
      d.sway += dt;
      if (d.y <= d.gy + 0.8) {
        this.drops.splice(i, 1);
        const p = { x: d.x, z: d.z, y: d.gy, active: true, respawnT: 0, spin: 0, kind: 'power', sub: d.sub, airdrop: true, temp: 40 };
        this.pickups.push(p);
        this.fx.add({ k: 'shock', x: d.x, y: d.gy + 0.3, z: d.z, life: 0.6, s0: 1, s1: 6, c0: [1, 0.9, 0.5], a: 0.8 });
        for (let k = 0; k < 6; k++) this.fx.dust(d.x, d.gy, d.z, 1);
        this.sfx('crate', d.x, d.z, 0.6);
      }
    }
  }

  spawnAirdrop() {
    const W = this.world;
    for (let tries = 0; tries < 50; tries++) {
      const x = (Math.random() - 0.5) * W.size * 0.6, z = (Math.random() - 0.5) * W.size * 0.6;
      if (!W.canPlace(x, z, 2, { noPath: false, spawnClear: 10, gap: 1 })) continue;
      const gy = W.heightAt(x, z);
      this.drops.push({ x, z, y: gy + 70, gy, sway: 0, sub: POWERUP_ORDER[Math.floor(Math.random() * POWERUP_ORDER.length)] });
      this.announce.push({ text: 'SUPPLY DROP INCOMING!', t: 0, col: '#ffd84d' });
      this.sound.play('drop', 0.6);
      return;
    }
  }

  collect(t, p) {
    let ok = false;
    const label = { text: '', col: PICKUP_KINDS[p.kind].css };
    if (p.kind === 'health') {
      if (t.hp >= t.maxHp) return false;
      t.hp = Math.min(t.maxHp, t.hp + PICKUP_KINDS.health.amount);
      t.burnT = 0;
      label.text = '+HEALTH';
      this.sfx('health', t.x, t.z, 0.8);
      ok = true;
    } else if (p.kind === 'ammo') {
      if (t.weapons.every((w) => w.ammo >= WEAPONS[w.id].maxAmmo)) return false;
      for (const w of t.weapons) w.ammo = Math.min(WEAPONS[w.id].maxAmmo, w.ammo + Math.ceil(WEAPONS[w.id].maxAmmo * 0.6));
      label.text = '+AMMO';
      this.sfx('pickup', t.x, t.z, 0.8);
      ok = true;
    } else if (p.kind === 'weapon') {
      const W = WEAPONS[p.sub];
      let w = t.weapons.find((x) => x.id === p.sub);
      if (!w) { w = { id: p.sub, ammo: 0 }; t.weapons.push(w); }
      w.ammo = Math.min(W.maxAmmo * 1.5, w.ammo + Math.ceil(W.maxAmmo * 0.8));
      label.text = '+' + W.name.toUpperCase();
      if (t.human) t.wi = t.weapons.indexOf(w);
      this.sfx('pickup', t.x, t.z, 0.8);
      ok = true;
    } else if (p.kind === 'power') {
      const P = POWERUPS[p.sub];
      t.power[p.sub] = P.dur;
      if (p.sub === 'shield') t.shieldHp = P.absorb;
      label.text = P.name.toUpperCase() + '!';
      label.col = P.css;
      this.sfx('power', t.x, t.z, 0.9);
      ok = true;
    }
    if (ok) {
      t.stats.pickups++;
      this.fx.popText(t.x, t.y + 4, t.z, label.text, 0.8, label.col, true);
      this.fx.add({ k: 'shock', x: p.x, y: p.y + 0.4, z: p.z, life: 0.4, s0: 1, s1: 5, c0: [1, 1, 0.8], a: 0.9 });
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        this.fx.add({ k: 'spark', x: p.x, y: p.y + 1, z: p.z, vx: Math.cos(a) * 6, vy: 6, vz: Math.sin(a) * 6, grav: 12, life: 0.5, w: 0.1, len: 0.6, c0: [1, 1, 0.7], c1: [1, 0.8, 0.3], a: 1 });
      }
    }
    return ok;
  }

  // ---------------- win conditions ----------------
  checkWin() {
    const cfg = this.cfg;
    let winner = null, reason = '';
    if (cfg.lives > 0) {
      const left = this.tanks.filter((t) => !t.eliminated);
      if (left.length === 1) { winner = left[0]; reason = 'Last tank standing'; }
      else if (left.length === 0) {
        // everyone went down together: best score wins, otherwise it's a draw
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
      this.sound.play('win', 0.8);
      this.sound.stopEngines();
      this.input.releaseLock();
      if (this.winner) for (let i = 0; i < 10; i++) this.later(i * 0.35, () => winner.alive && this.fireworks(winner.x + (Math.random() - 0.5) * 24, winner.y + 12 + Math.random() * 10, winner.z + (Math.random() - 0.5) * 24, i === 0));
    }
  }

  fireworks(x, y, z, first) {
    const cols = [[1, 0.3, 0.3], [0.3, 0.6, 1], [1, 0.9, 0.2], [0.4, 1, 0.5], [1, 0.4, 1]];
    const c = cols[Math.floor(Math.random() * cols.length)];
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI - Math.PI / 2, sp = 10 + Math.random() * 6;
      this.fx.add({ k: 'spark', x, y, z, vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp + 3, vz: Math.sin(a) * Math.cos(e) * sp, grav: 9, drag: 1.2, life: 1.1 + Math.random() * 0.5, w: 0.14, len: 0.8, c0: [1, 1, 1], c1: c, a: 1 });
    }
    this.fx.add({ k: 'glow', x, y, z, vx: 0, vy: 0, vz: 0, life: 0.25, s0: 1.5, s1: 4, c0: [1, 1, 1], c1: c, a: 1 });
    if (first) this.fx.popText(x, y + 3, z, 'VICTORY!', 1.6, '#ffdd33', true);
    this.sfx('explosion', x, z, 0.4, { size: 0.5 });
  }

  // ---------------- audio helpers ----------------
  listeners() {
    if (this.cams.length) return this.cams.map((c) => c.listen);
    return [[0, 0]];
  }

  spatial(x, z) {
    let best = 1e9, pan = 0;
    const birds = this.cfg.mode === 'birdseye';
    for (const c of this.cams) {
      const L = c.listen;
      const d = Math.hypot(x - L[0], z - L[1]);
      if (d < best) { best = d; pan = birds ? clamp((x - L[0]) / 60, -0.8, 0.8) : 0; }
    }
    if (!this.cams.length) best = Math.hypot(x, z);
    const vol = 1 / (1 + (best * best) / (birds ? 9000 : 3500));
    return [vol, pan];
  }

  sfx(name, x, z, vol = 1, opts) {
    const [v, p] = this.spatial(x, z);
    this.sound.play(name, vol * v, p, opts);
  }

  shakeAt(x, z, amt) {
    const [v] = this.spatial(x, z);
    this.shake = Math.max(this.shake, amt * v);
  }

  // ---------------- cameras & rendering ----------------
  layoutViews() {
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    const cfg = this.cfg;
    let subjects;
    if (this.state === 'lobby') return [{ x: 0, y: 0, w: W, h: H, kind: 'lobby', key: 'lobby' }];
    if (this.state === 'over' && this.winner && this.overT > 0.4) return [{ x: 0, y: 0, w: W, h: H, kind: 'winner', tank: this.winner, tanks: [this.winner], key: 'winner' }];
    const humans = this.humans;
    if (cfg.mode === 'birdseye' && !cfg.split && humans.length) {
      // Micro Machines style shared screen; splits automatically when players are too far apart to share it
      if (humans.length === 1) return [{ x: 0, y: 0, w: W, h: H, kind: 'birds', tanks: humans, key: 'shared' }];
      const need = this.birdsFit(humans.filter((t) => !t.eliminated), W / H).h;
      if (!this.autoSplit && need > cfg.maxZoom) this.autoSplit = true;
      else if (this.autoSplit && need < cfg.maxZoom * 0.8) this.autoSplit = false;
      if (!this.autoSplit) return [{ x: 0, y: 0, w: W, h: H, kind: 'birds', tanks: humans, key: 'shared' }];
    }
    subjects = humans.length ? humans : this.tanks.slice(0, 4);
    const n = subjects.length;
    const rects = n === 1 ? [[0, 0, W, H]] : n === 2 ? [[0, 0, W / 2, H], [W / 2, 0, W / 2, H]] : [[0, 0, W / 2, H / 2], [W / 2, 0, W / 2, H / 2], [0, H / 2, W / 2, H / 2], [W / 2, H / 2, W / 2, H / 2]];
    const views = subjects.map((t, i) => ({ x: rects[i][0], y: rects[i][1], w: rects[i][2], h: rects[i][3], kind: cfg.mode === 'birdseye' ? 'birds' : 'commander', tank: t, tanks: [t], key: 't' + t.id }));
    if (n === 3) views.push({ x: W / 2, y: H / 2, w: W / 2, h: H / 2, kind: 'overview', tanks: this.tanks, key: 'overview' });
    return views;
  }

  /** Birds-eye framing: smallest camera height that keeps every tank (plus margin) inside the view. */
  birdsFit(tanks, aspect, minH = this.cfg.zoom, maxH = 600) {
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9, cy = 0;
    const list = tanks.length ? tanks : this.tanks;
    for (const t of list) {
      const lx = t.x + t.vx * 0.4, lz = t.z + t.vz * 0.4;
      minX = Math.min(minX, lx); maxX = Math.max(maxX, lx); minZ = Math.min(minZ, lz); maxZ = Math.max(maxZ, lz); cy += t.y;
    }
    cy /= Math.max(1, list.length);
    const fx = (minX + maxX) / 2, fz = (minZ + maxZ) / 2;
    const vm = this._fitM || (this._fitM = [m4.create(), m4.create(), m4.create()]);
    const fits = (h) => {
      const z0 = this.birdsAnchor(fz, h);
      m4.lookAt(vm[0], fx, cy + h, z0 + h * 0.5, fx, cy, z0 - h * 0.04);
      m4.perspective(vm[1], (42 * Math.PI) / 180, aspect, 0.5, 900);
      m4.multiply(vm[2], vm[1], vm[0]);
      for (const t of list) for (const [ox, oz] of [[-6, -6], [6, 6], [-6, 6], [6, -6]]) {
        const p = m4.transform(vm[2], t.x + ox, t.y + 2, t.z + oz, 1);
        if (p[3] <= 0) return false;
        if (Math.abs(p[0] / p[3]) > 0.82 || p[1] / p[3] > 0.72 || p[1] / p[3] < -0.62) return false;
      }
      return true;
    };
    let h = minH;
    if (!fits(minH)) {
      let lo = minH, hi = maxH;
      for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
      h = hi;
    }
    return { fx, fz, cy, h };
  }

  /** The look-at point sits slightly ahead (north) so the tilted view is centred on the tanks. */
  birdsAnchor(fz, h) { return fz + h * 0.06; }

  updateCamera(v, dt) {
    const prev = this.camState || (this.camState = {});
    const st = prev[v.key] || (prev[v.key] = { fx: 0, fy: 0, fz: 0, h: 60, init: false, yaw: 0 });
    const shk = this.shake * this.shake * 1.6;
    const sx = (Math.random() - 0.5) * shk, sy = (Math.random() - 0.5) * shk, sz = (Math.random() - 0.5) * shk;
    let eye, at, fov = 45, near = 0.5, far = 900, fog = 0.0016, sky = true;
    if (v.kind === 'lobby') {
      const a = this.time * 0.05;
      eye = [Math.sin(a) * 110, 70, Math.cos(a) * 110];
      at = [0, 0, 0];
      fov = 50; fog = 0.002;
      v.focus = [0, 0, 0];
      v.camH = 70;
    } else if (v.kind === 'winner') {
      const t = v.tank;
      st.yaw += dt * 0.35;
      const R = 20;
      eye = [t.x + Math.sin(st.yaw) * R, t.y + 9, t.z + Math.cos(st.yaw) * R];
      at = [t.x, t.y - 1.5, t.z];
      fov = 50; fog = 0.002;
      v.focus = [t.x, t.y, t.z];
      v.camH = 20;
    } else if (v.kind === 'birds' || v.kind === 'overview') {
      const list = v.tanks.filter((t) => t.alive || !t.eliminated);
      const aspect = v.w / v.h;
      let fit;
      if (v.kind === 'overview') { fit = { fx: 0, fz: 0, cy: 0, h: this.world.size * 0.75 }; }
      else {
        fit = this.birdsFit(list, aspect, this.cfg.zoom, Math.max(this.cfg.maxZoom, this.cfg.zoom));
        // never zoom out past maxZoom for a single tank; shared views go as high as needed (split takes over beyond)
        if (list.length <= 1) fit.h = this.cfg.zoom;
        else fit.h = Math.min(fit.h, this.cfg.maxZoom * 1.15);
      }
      const k = st.init ? Math.min(1, dt * 3) : 1;
      st.fx = lerp(st.fx, fit.fx, k); st.fz = lerp(st.fz, fit.fz, k); st.fy = lerp(st.fy, fit.cy, k);
      // zoom out quickly (keep players on screen), zoom in gently
      st.h = lerp(st.h, fit.h, st.init ? Math.min(1, dt * (fit.h > st.h ? 3 : 0.9)) : 1);
      st.init = true;
      const z0 = this.birdsAnchor(st.fz, st.h);
      eye = [st.fx + sx * 3, st.fy + st.h + sy * 3, z0 + st.h * 0.5 + sz * 3];
      at = [st.fx + sx * 2, st.fy, z0 - st.h * 0.04];
      fov = 42;
      fog = 0.0009;
      v.focus = [st.fx, st.fy, st.fz];
      v.camH = st.h;
      sky = true;
    } else {
      const t = v.tank;
      if (!t.alive) {
        st.yaw += dt * 0.4;
        const R = 16;
        eye = [t.x + Math.sin(st.yaw) * R, t.y + 7, t.z + Math.cos(st.yaw) * R];
        at = [t.x, t.y + 1, t.z];
        fov = 55;
      } else {
        st.yaw = t.turretYaw + Math.PI;
        // gunner's sight sits just past the muzzle so the tank's own barrel never blocks the view
        const px = t.muzzle[0] + t.dir[0] * 0.3, py = Math.max(t.muzzle[1] + 0.35 * t.scale, t.y + 2.4), pz = t.muzzle[2] + t.dir[2] * 0.3;
        const W = WEAPONS[t.weapons[t.wi].id];
        let dir = t.dir.slice();
        if (W.kind === 'lob') {
          // look at the predicted impact point
          const imp = this.predictImpact(t, W);
          v.impact = imp;
          if (imp) { const dx = imp[0] - px, dy = imp[1] - py, dz = imp[2] - pz, l = Math.hypot(dx, dy, dz); dir = [dx / l, dy / l, dz / l]; }
        }
        const kick = t.camKick * 0.04;
        eye = [px + sx * 0.15, py + sy * 0.15, pz + sz * 0.15];
        at = [eye[0] + dir[0] * 10, eye[1] + (dir[1] + kick) * 10, eye[2] + dir[2] * 10];
        fov = t.zoom ? 58 / t.def.zoom : 58;
        near = 0.3;
      }
      fog = 0.0028;
      v.focus = [eye[0] + (at[0] - eye[0]) * 6, t.y, eye[2] + (at[2] - eye[2]) * 6];
    }
    m4.lookAt(this.view, eye[0], eye[1], eye[2], at[0], at[1], at[2]);
    m4.perspective(this.proj, (fov * Math.PI) / 180, v.w / v.h, near, far);
    v.view = Float32Array.from(this.view);
    v.proj = Float32Array.from(this.proj);
    v.vp = m4.multiply(m4.create(), v.proj, v.view);
    v.invVP = m4.invert(m4.create(), v.vp);
    v.cam = eye;
    v.fogDensity = fog;
    v.sky = sky;
    v.listen = [eye[0], eye[2] - (v.kind === 'birds' ? (v.camH || 0) * 0.5 : 0)];
    if (v.kind === 'birds' || v.kind === 'overview' || v.kind === 'lobby' || v.kind === 'winner') {
      v.shadowCenter = [v.focus[0], v.focus[1], v.focus[2] - (v.camH || 60) * 0.1];
      v.shadowRadius = Math.min(240, (v.camH || 60) * 1.3); // cover the corners of the tilted view
      v.listen = [v.focus[0], v.focus[2]];
    } else {
      const d = v.tank.alive ? (v.tank.zoom ? 70 : 45) : 20;
      v.shadowCenter = [v.focus[0], v.focus[1], v.focus[2]];
      const fdx = at[0] - eye[0], fdz = at[2] - eye[2], fl = Math.hypot(fdx, fdz) || 1;
      v.shadowCenter = [eye[0] + (fdx / fl) * d, v.tank.y, eye[2] + (fdz / fl) * d];
      v.shadowRadius = d + 15;
    }
  }

  predictImpact(t, W) {
    let x = t.muzzle[0], y = t.muzzle[1], z = t.muzzle[2];
    let vx = t.dir[0] * W.speed, vy = t.dir[1] * W.speed, vz = t.dir[2] * W.speed;
    const h = 1 / 30;
    for (let i = 0; i < 400; i++) {
      vy -= W.gravity * h;
      x += vx * h; y += vy * h; z += vz * h;
      if (y < this.world.heightAt(x, z)) return [x, this.world.heightAt(x, z), z];
    }
    return null;
  }

  render(dt) {
    const r = this.renderer;
    const dpr = Math.min(window.devicePixelRatio || 1, this.cfg.quality === 'high' ? 2 : this.cfg.quality === 'low' ? 1 : 1.5);
    r.resize(dpr);
    this.hud.resize(window.devicePixelRatio || 1);
    const views = this.layoutViews();
    for (const v of views) this.updateCamera(v, dt);
    this.cams = views;
    // dynamic instances
    const M = this.M;
    for (const mesh of r.meshes) if (!mesh.static) mesh.clear();
    const birds = this.cfg.mode === 'birdseye' || this.state === 'lobby';
    this.world.drawDynamic(this.time, birds && views[0].kind !== 'winner', views[0].camH || 60, views[0].focus || [0, 0, 0], this.tanks);
    this.drawTanks();
    this.drawProjectiles();
    this.drawPickups();
    this.drawAimGuides(views);
    this.fx.draw();
    r.beginFrame(this.time);
    for (const v of views) r.renderView(v);
    this.hud.draw(views, dt);
  }

  drawTanks() {
    const M = this.M, m = this.m;
    for (const t of this.tanks) {
      if (t.eliminated && !t.alive && t.wreckT > 4) continue;
      const parts = M.tanks[t.def.id];
      let [r, g, b] = t.color;
      if (!t.alive) { r = g = b = 0.18; }
      if (t.flashT > 0) { r = g = b = 4; }
      if (t.invulnT > 0 && Math.floor(this.time * 12) % 2 === 0) { r *= 1.8; g *= 1.8; b *= 1.8; }
      if (t.alive && t.power.ghost > 0 && Math.floor(this.time * 30) % 3 !== 0) continue;
      parts.hull.add(t.hullM, r, g, b);
      if (t.alive) {
        parts.turret.add(t.turretM, r, g, b);
        parts.barrel.add(t.barrelM, r, g, b);
        // team ring under the tank keeps small tanks easy to spot
        const n = t.n;
        alignToNormal(m, t.x, t.y + 0.12, t.z, n, 0, t.radius * 1.5, 1, t.radius * 1.5);
        M.teamRing.add(m, t.color[0], t.color[1], t.color[2], 0.75);
        if (t.shieldHp > 0 || t.invulnT > 0) {
          m4.compose(m, t.x, t.y + 1.2, t.z, this.time, 0, 0, t.radius * 1.9, t.radius * 1.4, t.radius * 1.9);
          const pulse = 0.18 + Math.sin(this.time * 8) * 0.06;
          const c = t.shieldHp > 0 ? [0.4, 0.55, 1] : [1, 1, 1];
          M.bubble.add(m, c[0], c[1], c[2], pulse);
        }
        if (t.power.speed > 0 && Math.abs(t.speed) > 4 && Math.random() < 0.5) this.fx.add({ k: 'glow', x: t.x - Math.sin(t.yaw) * 2.5, y: t.y + 1, z: t.z - Math.cos(t.yaw) * 2.5, vx: 0, vy: 0, vz: 0, life: 0.3, s0: 0.5, s1: 0.1, c0: [0.3, 0.9, 1], c1: [0.1, 0.4, 1], a: 0.8 });
        if (t.power.damage > 0 && Math.random() < 0.3) this.fx.add({ k: 'glow', x: t.muzzle[0], y: t.muzzle[1], z: t.muzzle[2], vx: 0, vy: 1, vz: 0, life: 0.3, s0: 0.4, s1: 0.1, c0: [1, 0.3, 0.6], c1: [1, 0.1, 0.3], a: 0.9 });
        if (t.hp < t.maxHp * 0.3 && Math.random() < 0.3) this.fx.smokeTrail(t.x, t.y + 1.8, t.z, 0.4, 0.25);
      }
    }
    for (const d of this.debris) {
      m4.compose(m, d.x, d.y, d.z, d.yaw, d.pitch, 0, d.scale);
      M.tanks[d.type].turret.add(m, 0.22, 0.2, 0.2);
    }
  }

  drawProjectiles() {
    const M = this.M, m = this.m;
    for (const p of this.projectiles) {
      const sp = Math.hypot(p.vx, p.vy, p.vz) || 1;
      const yaw = Math.atan2(p.vx, p.vz), pitch = -Math.asin(clamp(p.vy / sp, -1, 1));
      if (p.kind === 'shell') { m4.compose(m, p.x, p.y, p.z, yaw, pitch, 0, 0.22 * (p.W.size || 1), 0.22 * (p.W.size || 1), 0.45 * (p.W.size || 1)); M.shell.add(m); M.glow.add(m4.compose(m, p.x, p.y, p.z, 0, 0, 0, 0.35), 1, 0.8, 0.4, 0.6); }
      else if (p.kind === 'lob') { m4.compose(m, p.x, p.y, p.z, yaw, pitch, 0, 0.45, 0.45, 0.6); M.shell.add(m); }
      else if (p.kind === 'bullet') { m4.compose(m, p.x, p.y, p.z, yaw, pitch, 0, 0.08, 0.08, 2.2); M.spark.add(m, 1, 0.95, 0.5, 1); }
      else if (p.kind === 'rocket') { m4.compose(m, p.x, p.y, p.z, yaw, pitch, 0, 1.3); M.rocket.add(m); }
    }
    for (const mi of this.mines) {
      m4.compose(m, mi.x, mi.y, mi.z, 0, 0, 0, 1);
      const armed = mi.armT <= 0;
      const on = armed ? Math.floor(mi.blink * 3) % 2 === 0 : true;
      M.mine.add(m, on ? 1 : 0.3, armed ? 0.1 : 0.9, armed ? 0.1 : 0.2);
      if (armed && on) M.glow.add(m4.compose(m, mi.x, mi.y + 0.3, mi.z, 0, 0, 0, 0.35), 1, 0.2, 0.2, 0.7);
    }
    for (const b of this.beams) {
      const dx = b.ex - b.x, dy = b.ey - b.y, dz = b.ez - b.z, L = Math.hypot(dx, dy, dz) || 1;
      const yaw = Math.atan2(dx, dz), pitch = -Math.asin(dy / L);
      const k = 1 - b.age / 0.5;
      m4.compose(m, b.x, b.y, b.z, yaw, pitch, 0, 0.5 * k + 0.05, 0.5 * k + 0.05, L);
      M.beam.add(m, b.col[0], b.col[1], b.col[2], k);
      m4.compose(m, b.x, b.y, b.z, yaw, pitch, 0, 0.12, 0.12, L);
      M.beam.add(m, 1, 1, 1, k);
      // a spiral of sparkles along the beam
      if (b.age < 0.05) for (let s = 0; s < L; s += 3) this.fx.add({ k: 'glow', x: b.x + (dx / L) * s, y: b.y + (dy / L) * s, z: b.z + (dz / L) * s, vx: Math.cos(s) * 2, vy: Math.sin(s) * 2, vz: 0, life: 0.5, s0: 0.25, s1: 0.05, c0: [0.7, 1, 1], c1: [0.2, 0.6, 1], a: 1 });
    }
  }

  drawPickups() {
    const M = this.M, m = this.m;
    for (const p of this.pickups) {
      if (!p.active) continue;
      if (p.temp !== undefined && p.temp < 5 && Math.floor(p.spin * 6) % 2) continue; // blink before vanishing
      const bob = Math.sin(p.spin * 2.2) * 0.35;
      const y = p.y + 1.6 + bob;
      let col;
      if (p.kind === 'health') { M.health.add(m4.compose(m, p.x, y, p.z, p.spin * 1.2, 0, 0, 1.2), 1.15, 1.15, 1.15); col = [1, 0.35, 0.35]; }
      else if (p.kind === 'ammo') { M.ammo.add(m4.compose(m, p.x, y, p.z, p.spin * 1.2, 0, 0, 1.5)); col = [1, 0.85, 0.3]; }
      else if (p.kind === 'weapon') { M.wcrate.add(m4.compose(m, p.x, y, p.z, p.spin * 1.2, 0, 0, 1.5)); col = [1, 0.6, 0.2]; }
      else {
        const P = POWERUPS[p.sub];
        col = P.color;
        M.gem.add(m4.compose(m, p.x, y + 0.3, p.z, p.spin * 2, 0, 0, 1.5), col[0] * 1.3, col[1] * 1.3, col[2] * 1.3);
        M.glow.add(m4.compose(m, p.x, y + 0.3, p.z, 0, 0, 0, 1.5 + Math.sin(p.spin * 6) * 0.2), col[0], col[1], col[2], 0.35);
      }
      const n = this.world.normalAt(p.x, p.z, [0, 1, 0]);
      alignToNormal(m, p.x, p.y + 0.1, p.z, n, p.spin, 2.2, 1, 2.2);
      M.teamRing.add(m, col[0], col[1], col[2], 0.6 + Math.sin(p.spin * 4) * 0.2);
      // soft light beacon so pickups read from far away
      m4.compose(m, p.x, p.y + 0.1, p.z, p.spin * 0.5, 0, 0, 1.1, 10 + Math.sin(p.spin * 3) * 1.2, 1.1);
      M.beacon.add(m, col[0] * 0.4, col[1] * 0.4, col[2] * 0.4, 1);
      if (Math.random() < 0.08) this.fx.add({ k: 'glow', x: p.x + (Math.random() - 0.5) * 2, y: p.y + 0.5, z: p.z + (Math.random() - 0.5) * 2, vx: 0, vy: 3, vz: 0, life: 0.8, s0: 0.18, s1: 0.02, c0: [1, 1, 1], c1: col, a: 1 });
    }
    for (const d of this.drops) {
      const sw = Math.sin(d.sway * 1.5) * 0.15;
      M.wcrate.add(m4.compose(m, d.x, d.y, d.z, d.sway * 0.3, 0, sw, 1.2));
      M.chute.add(m4.compose(m, d.x - Math.sin(sw) * 5, d.y + 5, d.z, d.sway * 0.3, 0, sw, 1.2), 1, 0.3, 0.3);
      // dashed rope lines
      for (const [ox, oz] of [[-1.5, 0], [1.5, 0], [0, -1.5], [0, 1.5]]) {
        const sx = d.x + ox * 0.5, sy = d.y + 0.6, sz = d.z + oz * 0.5, ex = d.x + ox * 1.9 - Math.sin(sw) * 5, ey = d.y + 5, ez = d.z + oz * 1.9;
        const dx = ex - sx, dy = ey - sy, dz = ez - sz, L = Math.hypot(dx, dy, dz);
        M.dash.add(m4.compose(m, sx, sy, sz, Math.atan2(dx, dz), -Math.asin(dy / L), 0, 0.05, 0.05, L), 0.9, 0.9, 0.85, 1);
      }
      // landing marker
      alignToNormal(m, d.x, d.gy + 0.15, d.z, [0, 1, 0], this.time, 3, 1, 3);
      M.teamRing.add(m, 1, 0.85, 0.3, 0.5 + Math.sin(this.time * 6) * 0.3);
    }
  }

  /** Dotted aim trajectories for human players in birds-eye view. */
  drawAimGuides(views) {
    if (this.cfg.mode !== 'birdseye' || this.state === 'lobby') return;
    const M = this.M, m = this.m;
    for (const t of this.tanks) {
      if (!t.human || !t.alive) continue;
      const W = WEAPONS[t.weapons[t.wi].id];
      if (W.kind === 'mine') continue;
      let x = t.muzzle[0], y = t.muzzle[1], z = t.muzzle[2];
      const sp = W.speed || 200;
      let vx = t.dir[0] * sp, vy = t.dir[1] * sp, vz = t.dir[2] * sp;
      const g = W.gravity || 0;
      const maxLen = W.kind === 'rail' ? W.range : W.kind === 'flame' ? W.range : W.kind === 'bullet' ? 70 : W.kind === 'lob' ? 400 : 90;
      let dist = 0, i = 0;
      const step = 2.4;
      let end = null;
      while (dist < maxLen && i++ < 200) {
        const vl = Math.hypot(vx, vy, vz);
        const h = step / vl;
        const nx = x + vx * h, ny = y + vy * h, nz = z + vz * h;
        vy -= g * h;
        const gh = this.world.heightAt(nx, nz);
        if (ny < gh) { end = [nx, gh, nz]; break; }
        if (i % 2 === 0) {
          const dx = nx - x, dy = ny - y, dz = nz - z, L = Math.hypot(dx, dy, dz);
          const a = 0.55 * (1 - dist / maxLen) + 0.15;
          M.dash.add(m4.compose(m, x, y, z, Math.atan2(dx, dz), -Math.asin(dy / L), 0, 0.16, 0.16, L), t.color[0] * 1.2, t.color[1] * 1.2, t.color[2] * 1.2, a);
        }
        x = nx; y = ny; z = nz; dist += step;
      }
      if (end && (W.kind === 'lob' || W.kind === 'shell')) {
        const n = this.world.normalAt(end[0], end[2], [0, 1, 0]);
        const R = W.splash || 2;
        alignToNormal(m, end[0], end[1] + 0.15, end[2], n, this.time, R, 1, R);
        M.teamRing.add(m, t.color[0], t.color[1], t.color[2], 0.7);
      }
    }
  }
}

