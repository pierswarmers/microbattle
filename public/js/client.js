// Browser client: talks to the authoritative server, interpolates the replicated world, predicts the
// local turret for responsive aiming, renders three camera modes and turns server events into effects.
import { Renderer } from './gl.js';
import { createModels } from './models.js';
import { World, WATER_LEVEL } from './world.js';
import { FX } from './fx.js';
import { Sound } from './audio.js';
import { Input } from './input.js';
import { HUD } from './hud.js';
import { Net } from './net.js';
import { ballisticPitch, seekerSpeed } from './ai.js';
import { TANK_TYPES, TANK_ORDER, TANK_GEOM, WEAPONS, WEAPON_ORDER, POWERUPS, PLAYER_COLORS } from './defs.js';
import { m4, clamp, lerp, wrapAngle, approachAngle, makeRng, alignToNormal, dirFromYawPitch } from './math.js';

export const VIEWS = ['chase', 'commander', 'birdseye'];
export const VIEW_NAMES = { chase: 'CHASE CAM', commander: 'COMMANDER', birdseye: "BIRD'S-EYE" };
const INTERP = 0.08; // seconds of interpolation delay for remote tanks
const FUN_NAMES = ['Tankzilla', 'Sir Boom', 'Major Mayhem', 'Captain Crunch', 'Rusty', 'Lil Treads', 'Big Bertha', 'Turret Tom', 'Boomer', 'Pebbles'];

export class Client {
  constructor(canvas, hudCanvas, opts = {}) {
    this.canvas = canvas;
    this.hudCanvas = hudCanvas;
    this.opts = opts;
    this.input = new Input(canvas);
    this.status = 'connecting';
    this.name = opts.name || safeStore('mb_name') || FUN_NAMES[Math.floor(Math.random() * FUN_NAMES.length)];
    this.type = TANK_ORDER.includes(opts.type) ? opts.type : safeStore('mb_type') || 'standard';
    this.you = -1;
    this.cfg = null;
    this.snaps = [];
    this.state = 'connecting';
    this.tanks = new Map();
    this.proj = new Map();
    this.pickups = [];
    this.drops = [];
    this.strikes = [];
    this.smokes = [];
    this.jets = [];
    this.debris = [];
    this.killfeed = [];
    this.announce = [];
    this.lobby = { players: [] };
    this.time = 0;
    this.realTime = 0;
    this.shake = 0;
    this.flash = 0;
    this.aim = { yaw: 0, pitch: 0.05, range: 60, mouse: false, mouseBlock: -1, pitchMem: {} };
    this.pred = { yaw: 0, pitch: 0.05 };
    this.weapon = null;
    this.smokeSeq = 0;
    this.lock = { cand: -1, t: 0, id: -1 };
    this.incoming = 0;
    this.camState = { init: false, fx: 0, fz: 0, fy: 0, h: 120, yaw: 0, eye: null };
    this.zoomH = null;
    this.help = false;
    this.m = m4.create();
    this.view = 'chase';
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.net = new Net(opts.url || `${proto}://${location.host}/ws`, (m) => this.onMessage(m), (s) => this.onStatus(s));
  }

  onStatus(s) {
    this.status = s;
    if (s === 'open') this.net.send({ t: 'hello', name: this.name, type: this.type });
  }

  onMessage(m) {
    if (m.t === 'welcome') this.onWelcome(m);
    else if (m.t === 'lobby') this.lobby = m;
    else if (m.t === 'snap' && this.world) this.onSnap(m);
  }

  onWelcome(m) {
    this.you = m.you;
    const fresh = !this.cfg || this.cfg.seed !== m.cfg.seed;
    this.cfg = { ...m.cfg, ...(this.opts.cfgOverride || {}) };
    if (fresh) this.build();
    for (const o of this.world.obstacles) o.alive = true;
    for (const i of m.dead) if (this.world.obstacles[i]) this.world.obstacles[i].alive = false;
    this.view = this.cfg.mode === 'any' ? (VIEWS.includes(this.opts.view) ? this.opts.view : 'chase') : this.cfg.mode;
    this.zoomH = this.cfg.zoom;
    document.getElementById('loading')?.remove();
  }

  build() {
    if (this.renderer) return; // same world as before a reconnect
    const cfg = this.cfg;
    this.renderer = new Renderer(this.canvas, { shadows: cfg.quality !== 'low', shadowSize: cfg.quality === 'low' ? 1024 : 2048, preserve: !!this.opts.debug });
    this.M = createModels(this.renderer, makeRng(cfg.seed + 1));
    this.world = new World(this.renderer, this.M, cfg);
    this.fx = new FX(this.M, this.world);
    this.sound = new Sound({ volume: this.opts.volume ?? 0.7, music: this.opts.music !== false, mute: !!this.opts.mute });
    this.hud = new HUD(this.hudCanvas, this);
  }

  get me() { return this.tanks.get(this.you); }

  // ---------------- replication ----------------
  onSnap(s) {
    const now = performance.now() / 1000;
    s.recv = now;
    s.byId = new Map(s.tanks.map((t) => [t.id, t]));
    this.snaps.push(s);
    while (this.snaps.length > 12) this.snaps.shift();
    const prevState = this.state;
    this.state = s.state;
    this.serverTime = s.time;
    this.serverRecv = now;
    this.snap = s;
    if (s.state === 'countdown' && prevState !== 'countdown') this.onMatchStart();
    // tanks
    const seen = new Set();
    for (const e of s.tanks) {
      seen.add(e.id);
      let t = this.tanks.get(e.id);
      if (!t || t.type !== e.type) t = this.makeTank(e, t);
      Object.assign(t.net, e);
      if (!t.wasAlive && e.al) { t.x = e.x; t.y = e.y; t.z = e.z; t.yaw = e.yaw; t.ty = e.ty; t.wreckT = 0; if (e.id === this.you) this.resetAim(e); }
      t.wasAlive = !!e.al;
    }
    for (const id of [...this.tanks.keys()]) if (!seen.has(id)) this.tanks.delete(id);
    // projectiles
    const pseen = new Set();
    for (const a of s.proj) {
      const [id, kind, w, x, y, z, vx, vy, vz, g, tgt] = a;
      pseen.add(id);
      let p = this.proj.get(id);
      if (!p) { p = { id, kind, w, trail: 0 }; this.proj.set(id, p); }
      Object.assign(p, { x, y, z, vx, vy, vz, g, tgt });
    }
    for (const id of [...this.proj.keys()]) if (!pseen.has(id)) this.proj.delete(id);
    this.pickups = s.pick.map(([a, k, sub, x, z, temp], i) => ({ active: !!a, kind: k, sub, x, z, y: this.world.heightAt(x, z), temp, spin: (this.pickups[i] && this.pickups[i].spin) || Math.random() * 6 }));
    this.drops = s.drops.map(([id, x, y, z, gy]) => ({ id, x, y, z, gy }));
    this.strikes = s.strikes.map(([id, x, z, r, t, by]) => ({ id, x, z, r, t, by }));
    this.smokes = s.smokes.map(([id, x, z, r, age, life]) => ({ id, x, z, r, age, life }));
    for (const ev of s.ev) this.onEvent(ev);
  }

  makeTank(e, old) {
    const def = TANK_TYPES[e.type];
    const col = PLAYER_COLORS[e.id];
    const t = old || { id: e.id, net: {}, x: e.x, y: e.y, z: e.z, yaw: e.yaw, ty: e.ty, p: e.p, n: [0, 1, 0], hullM: m4.create(), turretM: m4.create(), barrelM: m4.create(), muzzle: [0, 0, 0], dir: [0, 0, 1], recoil: 0, flashT: 0, trackAcc: 0, wreckT: 0, rock: 0 };
    Object.assign(t, { type: e.type, def, geom: TANK_GEOM[e.type], color: col.rgb, css: col.css, scale: def.scale, radius: def.radius });
    this.tanks.set(e.id, t);
    return t;
  }

  resetAim(e) {
    this.aim.yaw = this.pred.yaw = e.ty;
    this.aim.pitch = this.pred.pitch = e.p;
    this.aim.mouse = false;
  }

  onMatchStart() {
    this.killfeed = []; this.announce = []; this.debris = []; this.jets = [];
    this.fx.parts = []; this.fx.decals = []; this.fx.texts = []; this.fx.tracks = [];
    this.weapon = null;
  }

  /** Interpolated state of tank t for rendering. */
  sample(t, now) {
    const own = t.id === this.you;
    const serverNow = this.serverTime + (now - this.serverRecv);
    if (own) {
      // own tank: newest data, nudged forward by its velocity so driving feels immediate
      const e = t.net, dtE = clamp(serverNow - this.serverTime, 0, 0.1);
      return { x: e.x + e.vx * dtE, y: e.y, z: e.z + e.vz * dtE, yaw: e.yaw + 0, ty: e.ty, p: e.p };
    }
    const rt = serverNow - INTERP;
    let a = null, b = null;
    for (let i = this.snaps.length - 1; i >= 0; i--) {
      const s = this.snaps[i];
      if (s.time <= rt) { a = s; b = this.snaps[i + 1] || s; break; }
    }
    if (!a) { a = b = this.snaps[0]; }
    const ea = a.byId.get(t.id), eb = (b && b.byId.get(t.id)) || ea;
    if (!ea) return t.net;
    const k = b && b.time > a.time ? clamp((rt - a.time) / (b.time - a.time), 0, 1) : 0;
    return { x: lerp(ea.x, eb.x, k), y: lerp(ea.y, eb.y, k), z: lerp(ea.z, eb.z, k), yaw: ea.yaw + wrapAngle(eb.yaw - ea.yaw) * k, ty: ea.ty + wrapAngle(eb.ty - ea.ty) * k, p: lerp(ea.p, eb.p, k) };
  }

  // ---------------- events → effects ----------------
  onEvent(e) {
    const fx = this.fx, me = this.me;
    const at = (x, z, v = 1, name, opts) => this.sfx(name, x, z, v, opts);
    switch (e.e) {
      case 'count': this.sound.play('count', 0.8); break;
      case 'go': this.sound.play('go', 0.8); this.announce.push({ text: 'GO!', t: 0, big: true }); break;
      case 'fire': {
        const t = this.tanks.get(e.id);
        if (!t) break;
        const W = WEAPONS[e.w];
        const [mx, my, mz] = t.muzzle, [dx, dy, dz] = t.dir;
        const own = e.id === this.you;
        const off = own && this.view === 'commander' ? 2.2 : 0;
        if (W.kind === 'flame') { for (let i = 0; i < 3; i++) fx.flame(mx, my, mz, dx * 28 + (Math.random() - 0.5) * 4, dy * 28 + 1, dz * 28 + (Math.random() - 0.5) * 4); at(mx, mz, 0.6, 'flame'); break; }
        const size = W.hv ? 1.6 : W.nuke ? 2 : W.kind === 'shell' ? 1.2 * (t.def.gun.dmg) : W.kind === 'cluster' ? 1.1 : W.kind === 'bullet' ? 0.35 : 0.7;
        fx.muzzle(mx + dx * off, my + dy * off, mz + dz * off, dx, dy, dz, off ? size * 0.6 : size, W.color, !off);
        t.recoil = Math.min(1, t.recoil + W.recoil);
        if (W.hv) {
          t.rock = 1;
          fx.add({ k: 'shock', x: mx, y: my, z: mz, life: 0.25, s0: 0.5, s1: 6, c0: [0.8, 0.95, 1], a: 0.9 });
          for (let i = 0; i < 10; i++) fx.dust(t.x + (Math.random() - 0.5) * 5, t.y, t.z + (Math.random() - 0.5) * 5, 1);
        } else if (W.kind === 'shell' || W.kind === 'cluster') for (let i = 0; i < 4; i++) fx.dust(t.x + (Math.random() - 0.5) * 3, t.y, t.z + (Math.random() - 0.5) * 3, 1);
        at(mx, mz, own ? 1 : 0.85, W.hv ? 'highvel' : W.nuke ? 'massive' : W.kind === 'cluster' ? 'cluster' : W.kind === 'seeker' ? 'seeker' : W.kind === 'strike' ? 'strike' : W.kind === 'bullet' ? 'rapid' : 'standard');
        if (own) { this.shake = Math.max(this.shake, W.shake * (this.view === 'birdseye' ? 1 : 0.6)); this.kick = W.recoil; }
        break;
      }
      case 'boom': {
        if (e.c === 'cluster' && e.s < 0.8) { fx.bomblet(e.x, e.y, e.z); at(e.x, e.z, 0.8, 'bomblet'); this.shakeAt(e.x, e.z, 0.12); break; }
        fx.explode(e.x, e.y, e.z, e.s, e.c === 'strike' ? { text: Math.random() < 0.2 ? 'KA-BLAM!' : undefined } : {});
        at(e.x, e.z, Math.min(1.3, 0.6 + e.s * 0.3), e.c === 'strike' ? 'bomb' : 'explosion', { size: e.s });
        this.shakeAt(e.x, e.z, 0.25 * e.s + 0.1);
        break;
      }
      case 'nuke':
        fx.nuke(e.x, e.y, e.z);
        this.sound.play('nuke', Math.max(0.5, this.spatial(e.x, e.z)[0] * 1.5));
        this.shakeAt(e.x, e.z, 2.0, 0.45);
        { const d = this.distToCam(e.x, e.z); if (d < 260) this.flash = Math.max(this.flash, 1 - d / 260); }
        break;
      case 'cluster': fx.clusterBurst(e.x, e.y, e.z); at(e.x, e.z, 0.8, 'clusterPop'); break;
      case 'hvhit': fx.hvImpact(e.x, e.y, e.z); at(e.x, e.z, 1, 'hvhit'); this.shakeAt(e.x, e.z, 0.5); break;
      case 'impact': fx.impact(e.x, e.y, e.z, [1, 0.9, 0.5], 5); at(e.x, e.z, 0.35, 'ping'); break;
      case 'splash': fx.splash(e.x, e.z, e.s); at(e.x, e.z, e.s > 1 ? 0.8 : 0.3, 'splash'); break;
      case 'leaves': fx.leaves(e.x, e.y, e.z, [0.4, 0.75, 0.3], e.n); if (e.canopy) fx.popText(e.x, e.y + 2, e.z, 'TREE SAVE!', 0.7, '#8fff7a'); break;
      case 'bump': fx.impact(e.x, e.y, e.z, [0.8, 0.7, 0.5], 4); if (e.tree) fx.leaves(e.x, e.y + 3, e.z, [0.4, 0.75, 0.3], 6); at(e.x, e.z, 0.4, 'ram'); break;
      case 'ram': fx.impact(e.x, e.y, e.z, [1, 0.8, 0.4], 12); at(e.x, e.z, 1, 'ram'); this.shakeAt(e.x, e.z, 0.4); break;
      case 'hit': {
        const t = this.tanks.get(e.id);
        if (t) {
          if (e.a >= 4) t.flashT = 0.1;
          fx.texts.push({ x: t.x + (Math.random() - 0.5) * 2, y: t.y + 3.5, z: t.z, text: '-' + e.a, scale: 0.55, age: 0, life: 0.8, col: '#fff36b', rot: 0, small: true });
          if (fx.texts.length > 24) fx.texts.shift();
          at(t.x, t.z, 0.6, 'hit');
        }
        if (e.id === this.you) { if (e.dir !== null) { this.dmgDir = e.dir; this.dmgT = 1; } this.shake = Math.max(this.shake, Math.min(0.5, e.a / 60)); }
        if (e.by === this.you && e.id !== this.you) this.hitMarkT = 0.25;
        break;
      }
      case 'shield': { const t = this.tanks.get(e.id); if (t) at(t.x, t.z, 0.6, 'shieldHit'); break; }
      case 'kill': {
        const t = this.tanks.get(e.id), by = this.tanks.get(e.by);
        fx.explode(e.x, e.y + 1, e.z, 2.6, {});
        fx.explode(e.x, e.y + 2, e.z, 1.5, { debrisCol: t ? t.color : null, text: ['KABOOM!', 'KA-BLAM!', 'BOOM!', 'WHAMMO!'][Math.floor(Math.random() * 4)] });
        at(e.x, e.z, 1.2, 'explosion', { size: 2.6 });
        at(e.x, e.z, 0.6, 'death');
        this.shakeAt(e.x, e.z, 0.9);
        if (t) {
          const a = Math.random() * Math.PI * 2;
          this.debris.push({ type: t.type, x: t.turretM[12], y: t.turretM[13], z: t.turretM[14], vx: Math.cos(a) * 5, vy: 16 + Math.random() * 6, vz: Math.sin(a) * 5, yaw: e.ty, pitch: 0, wy: (Math.random() - 0.5) * 8, wp: (Math.random() - 0.5) * 8, scale: t.scale, age: 0 });
        }
        if (e.by === this.you && e.id !== this.you) this.sound.play('kill', 0.6);
        this.killfeed.push({ a: by && by !== t ? by.net.name : t ? t.net.name : '?', ac: by && by !== t ? by.css : t ? t.css : '#fff', b: by && by !== t ? (t ? t.net.name : '?') : 'self-destructed', bc: by && by !== t && t ? t.css : '#aaa', w: e.c, self: !by || by === t, t: 0 });
        if (this.killfeed.length > 5) this.killfeed.shift();
        break;
      }
      case 'respawn': { const t = this.tanks.get(e.id); if (t) fx.add({ k: 'shock', x: e.x, y: e.y + 0.3, z: e.z, life: 0.6, s0: 6, s1: 0.5, c0: t.color, a: 0.9 }); at(e.x, e.z, 0.8, 'respawn'); break; }
      case 'pickup': {
        fx.popText(e.x, e.y + 4, e.z, e.label, 0.8, e.col, true);
        fx.add({ k: 'shock', x: e.x, y: e.y + 0.4, z: e.z, life: 0.4, s0: 1, s1: 5, c0: [1, 1, 0.8], a: 0.9 });
        for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; fx.add({ k: 'spark', x: e.x, y: e.y + 1, z: e.z, vx: Math.cos(a) * 6, vy: 6, vz: Math.sin(a) * 6, grav: 12, life: 0.5, w: 0.1, len: 0.6, c0: [1, 1, 0.7], c1: [1, 0.8, 0.3], a: 1 }); }
        at(e.x, e.z, 0.9, e.k === 'health' ? 'health' : e.k === 'power' ? 'power' : 'pickup');
        break;
      }
      case 'pickupSpawn': fx.add({ k: 'shock', x: e.x, y: this.world.heightAt(e.x, e.z) + 0.3, z: e.z, life: 0.5, s0: 0.5, s1: 4, c0: [1, 1, 1], a: 0.7 }); break;
      case 'obs': {
        const o = this.world.obstacles[e.i];
        if (!o) break;
        o.alive = false;
        if (o.kind === 'bush') { fx.leaves(o.x, o.y + 0.5, o.z, o.col, 12); at(o.x, o.z, 0.5, 'bush'); }
        else if (o.kind === 'fence') { fx.leaves(o.x, o.top - 0.8, o.z, [0.85, 0.75, 0.6], 8); at(o.x, o.z, 0.4, 'crate'); }
        else if (o.kind === 'crate') { fx.leaves(o.x, o.y + 1, o.z, [0.78, 0.55, 0.3], 14); fx.impact(o.x, o.y + 1, o.z, [1, 0.8, 0.5], 6); at(o.x, o.z, 0.8, 'crate'); }
        break;
      }
      case 'smoke': {
        at(e.x, e.z, 0.8, 'smoke');
        for (let i = -1; i <= 1; i++) { const a = e.yaw + i * 0.6; for (let k = 0; k < 6; k++) fx.smokePuff(e.x + Math.sin(a) * 6, this.world.heightAt(e.x, e.z), e.z + Math.cos(a) * 6, 3); }
        break;
      }
      case 'strike': {
        this.sound.play('siren', 0.55);
        const by = this.tanks.get(e.by);
        this.announce.push({ text: 'AIR STRIKE INBOUND!', t: 0, col: '#ff4a3a' });
        fx.add({ k: 'shock', x: e.x, y: this.world.heightAt(e.x, e.z) + 0.3, z: e.z, life: 0.8, s0: 2, s1: e.r, c0: [1, 0.25, 0.2], a: 1 });
        if (by) fx.popText(e.x, this.world.heightAt(e.x, e.z) + 8, e.z, 'TARGET MARKED', 1, '#ff5a4a', true);
        break;
      }
      case 'strikeRun': {
        for (let i = -1; i <= 1; i += 2) this.jets.push({ x: e.x - e.dx * 160 + -e.dz * i * 9, z: e.z - e.dz * 160 + e.dx * i * 9, y: this.world.heightAt(e.x, e.z) + 32 + i, dx: e.dx, dz: e.dz, age: 0 });
        this.sound.play('jet', Math.max(0.3, this.spatial(e.x, e.z)[0]));
        break;
      }
      case 'ignite': {
        const t = this.tanks.get(e.id);
        fx.popText(e.x, e.y + 4.5, e.z, 'FUEL FIRE!', 1.2, '#ff7a2f', true);
        for (let i = 0; i < 16; i++) fx.flame(e.x + (Math.random() - 0.5) * 2, e.y + 1.5, e.z + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 6, 4 + Math.random() * 4, (Math.random() - 0.5) * 6);
        at(e.x, e.z, 1, 'ignite');
        if (e.id === this.you) this.announce.push({ text: 'YOUR FUEL CAUGHT FIRE!', t: 0, col: '#ff7a2f' });
        if (t) t.flashT = 0.2;
        break;
      }
      case 'announce': this.announce.push({ text: e.text, t: 0, col: e.col }); if (e.drop) this.sound.play('drop', 0.6); break;
      case 'landed': for (let k = 0; k < 6; k++) fx.dust(e.x, this.world.heightAt(e.x, e.z), e.z, 1); fx.add({ k: 'shock', x: e.x, y: this.world.heightAt(e.x, e.z) + 0.3, z: e.z, life: 0.6, s0: 1, s1: 6, c0: [1, 0.9, 0.5], a: 0.8 }); at(e.x, e.z, 0.6, 'crate'); break;
      case 'locked': if (e.target === this.you) { this.incoming = 3; this.sound.play('locked', 0.7); } break;
      case 'empty': if (e.id === this.you) this.sound.play('empty', 0.5); break;
      case 'win': {
        this.sound.play('win', 0.8);
        this.overT = 0;
        const w = this.tanks.get(e.id);
        if (w) for (let i = 0; i < 10; i++) setTimeout(() => this.fireworks(w.x + (Math.random() - 0.5) * 24, w.y + 12 + Math.random() * 10, w.z + (Math.random() - 0.5) * 24, i === 0), i * 350);
        this.input.releaseLock();
        break;
      }
      case 'restart':
        for (const o of this.world.obstacles) o.alive = true;
        break;
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
  distToCam(x, z) { const L = this.listen || [0, 0]; return Math.hypot(x - L[0], z - L[1]); }
  spatial(x, z) {
    const L = this.listen || [0, 0];
    const d = Math.hypot(x - L[0], z - L[1]);
    const birds = this.view === 'birdseye';
    const vol = 1 / (1 + (d * d) / (birds ? 12000 : 3500));
    let pan = 0;
    if (this.camRight) pan = clamp(((x - L[0]) * this.camRight[0] + (z - L[1]) * this.camRight[2]) / 40, -0.8, 0.8);
    return [vol, pan];
  }
  sfx(name, x, z, vol = 1, opts) { const [v, p] = this.spatial(x, z); this.sound.play(name, vol * v, p, opts); }
  shakeAt(x, z, amt, min = 0) { const [v] = this.spatial(x, z); this.shake = Math.max(this.shake, Math.max(min, amt * v)); }

  // ---------------- per-frame ----------------
  frame(nowMs) {
    const now = nowMs / 1000;
    let dt = this.lastNow ? now - this.lastNow : 1 / 60;
    this.lastNow = now;
    dt = Math.min(dt, 0.1);
    this.realTime += dt;
    this.fps = lerp(this.fps || 60, 1 / Math.max(dt, 1e-3), 0.05);
    this.input.pollPads();
    if (this.input.anyKey && !this.audioStarted && this.sound) { this.audioStarted = true; this.sound.init(); }
    if (!this.world) { this.input.endFrame(); return; }
    this.time += dt;
    this.handleKeys();
    if (this.state === 'lobby' || this.state === 'connecting') this.lobbyControls();
    else this.playerControls(dt, now);
    this.world.updateAmbient(dt, this.time);
    this.fx.update(dt);
    this.updateCosmetics(dt, now);
    this.render(dt, now);
    this.input.endFrame();
  }

  handleKeys() {
    const I = this.input;
    if (I.take('Escape')) { this.help = !this.help; if (this.help) I.releaseLock(); }
    if (I.take('KeyM')) this.sound.setMuted(!this.sound.muted);
    if (I.take('F2', 'KeyX')) this.opts.debug = !this.opts.debug;
    if (this.state === 'over' && (I.take('Enter') || I.padPressed(9))) this.net.send({ t: 'start' });
  }

  lobbyControls() {
    const I = this.input;
    let d = 0;
    if (I.take('KeyA', 'ArrowLeft') || I.padPressed(14)) d = -1;
    if (I.take('KeyD', 'ArrowRight') || I.padPressed(15)) d = 1;
    if (d) {
      const i = TANK_ORDER.indexOf(this.type);
      this.type = TANK_ORDER[(i + d + TANK_ORDER.length) % TANK_ORDER.length];
      safeStore('mb_type', this.type);
      this.net.send({ t: 'lobby', type: this.type });
      if (this.audioStarted) this.sound.play('switch', 0.6);
    }
    const mine = this.lobby.players.find((p) => p.slot === this.you && this.you >= 0);
    if (I.take('Space') || I.padPressed(0)) { this.net.send({ t: 'lobby', ready: !(mine && mine.ready) }); this.sound.init(); this.audioStarted = true; this.sound.play('pickup', 0.6); }
    if (I.take('Enter') || I.padPressed(9)) { this.net.send({ t: 'start' }); this.sound.init(); this.audioStarted = true; }
    if (I.take('KeyN')) {
      const n = window.prompt('Your name:', this.name);
      if (n) { this.name = n.slice(0, 14); safeStore('mb_name', this.name); this.net.send({ t: 'hello', name: this.name, type: this.type }); }
    }
  }

  /** Read controls, update the local aim + predicted turret, and send the input record to the server. */
  playerControls(dt, now) {
    const I = this.input, ms = I.mouse;
    const c = I.read();
    const me = this.me;
    if (c.view && this.cfg.mode === 'any') {
      this.view = VIEWS[(VIEWS.indexOf(this.view) + 1) % VIEWS.length];
      this.sound.play('switch', 0.5);
      this.viewFlash = 1.4;
      if (this.view === 'birdseye') I.releaseLock();
    }
    if (this.view === 'birdseye' && ms.wheel) this.zoomH = clamp(this.zoomH * (1 + ms.wheel * 0.1), 50, 260);
    if (!me || !me.net.al || this.state === 'over') { this.sendInput({ th: 0, tu: 0, f: false }); return; }
    const def = me.def, e = me.net;
    // weapon selection
    const owned = e.w.map(([id]) => id);
    if (!this.weapon || !owned.includes(this.weapon)) this.weapon = owned[e.wi] || owned[0];
    let wsel = this.weapon;
    if (c.prev || c.next) {
      const i = owned.indexOf(wsel);
      wsel = owned[(i + (c.next ? 1 : -1) + owned.length) % owned.length];
    }
    if (c.pick >= 0 && owned.includes(WEAPON_ORDER[c.pick])) wsel = WEAPON_ORDER[c.pick];
    if (ms.wheel && this.view !== 'birdseye') { const i = owned.indexOf(wsel); wsel = owned[(i + Math.sign(ms.wheel) + owned.length) % owned.length]; }
    if (wsel !== this.weapon) {
      this.aim.pitchMem[this.weapon] = this.aim.pitch;
      this.weapon = wsel;
      const W2 = WEAPONS[wsel];
      if (W2.kind !== 'seeker' && W2.kind !== 'strike') this.aim.pitch = clamp(this.aim.pitchMem[wsel] ?? 0.04, def.pitchMin, def.pitchMax);
      this.sound.play('switch', 0.5);
      this.lock = { cand: -1, t: 0, id: -1 };
    }
    const W = WEAPONS[this.weapon];
    const lobbed = W.kind === 'seeker' || W.kind === 'strike';
    // aiming: keys
    if (c.keyAim) { this.aim.mouse = false; this.aim.mouseBlock = ms.moved; }
    this.aim.yaw = wrapAngle(this.aim.yaw + c.turret * def.turret * 1.05 * dt);
    if (lobbed) this.aim.range = clamp(this.aim.range * (1 + c.elev * 0.9 * dt), W.minRange || 15, W.range);
    else this.aim.pitch += c.elev * def.pitchSpeed * dt;
    // aiming: mouse
    if (this.cfg.mouse !== false) {
      if (this.view !== 'birdseye') {
        if (ms.clicked && !ms.locked && !this.help) { I.requestLock(); ms.clicked = false; }
        if (ms.locked) {
          const zk = c.zoom || ms.right ? 1 / def.zoom : 1;
          this.aim.yaw = wrapAngle(this.aim.yaw - ms.dx * 0.0025 * zk);
          if (lobbed) this.aim.range = clamp(this.aim.range * (1 - ms.dy * 0.004), W.minRange || 15, W.range);
          else this.aim.pitch -= ms.dy * 0.0022 * zk;
          if (ms.buttons & 1) c.fire = true;
          if (ms.right) c.zoom = true;
        }
      } else {
        if (ms.moved > this.aim.mouseBlock && now * 1000 - ms.moved < 2500 && !c.keyAim) this.aim.mouse = true;
        if (this.aim.mouse && this.cam) {
          const hit = this.pickGround(this.cam, ms.x, ms.y);
          if (hit) {
            const dx = hit[0] - me.x, dz = hit[2] - me.z, d = Math.hypot(dx, dz);
            this.aim.yaw = Math.atan2(dx, dz);
            this.mouseTarget = hit;
            if (lobbed) this.aim.range = clamp(d, W.minRange || 15, W.range);
            else this.aim.pitch = this.solvePitch(me, W, d, hit[1] + 1);
          }
        }
        if (ms.buttons & 1) c.fire = true;
      }
    }
    // keep keyboard aim close to the real turret so it doesn't wind up
    const mouseLook = ms.locked && this.view !== 'birdseye';
    const dYaw = wrapAngle(this.aim.yaw - this.pred.yaw);
    if (!this.aim.mouse && !mouseLook && Math.abs(dYaw) > 0.6) this.aim.yaw = wrapAngle(this.pred.yaw + Math.sign(dYaw) * 0.6);
    this.aim.pitch = clamp(this.aim.pitch, def.pitchMin, def.pitchMax);
    this.zoomed = c.zoom && this.view === 'commander';
    // predicted turret: same slew as the server, gently corrected toward the server's value
    this.pred.yaw = wrapAngle(approachAngle(this.pred.yaw, this.aim.yaw, def.turret * dt));
    this.pred.pitch += clamp(this.aim.pitch - this.pred.pitch, -def.pitchSpeed * dt, def.pitchSpeed * dt);
    const err = wrapAngle(e.ty - this.pred.yaw);
    if (Math.abs(err) > 0.02) this.pred.yaw = wrapAngle(this.pred.yaw + err * Math.min(1, dt * 3));
    this.pred.pitch += (e.p - this.pred.pitch) * Math.min(1, dt * 3);
    // seeker lock-on: commander view only, target held near the centre of the sight
    this.updateLock(dt, W);
    if (c.smoke) this.smokeSeq++;
    const aimDist = lobbed ? (this.lock.id >= 0 ? this.lockDist : this.aim.range) : this.rangeAlongGun(me) || 80;
    this.sendInput({ th: c.throttle, tu: c.turn, ay: +this.aim.yaw.toFixed(4), ap: +this.aim.pitch.toFixed(4), ad: +aimDist.toFixed(1), f: c.fire && !this.help, w: this.weapon, lk: this.lock.id, sm: this.smokeSeq });
  }

  sendInput(m) {
    m.t = 'in';
    const key = JSON.stringify(m);
    // send on change, and at least 10x per second
    if (key !== this.lastInput || this.realTime - (this.lastSent || 0) > 0.1) {
      this.net.send(m);
      this.lastInput = key;
      this.lastSent = this.realTime;
    }
  }

  solvePitch(me, W, d, ty) {
    const gun = W.id === 'standard' ? me.def.gun.speed || 1 : 1;
    const v = (W.speed || 100) * gun;
    if (!W.gravity) return Math.atan2(ty - me.muzzle[1], d);
    let p = ballisticPitch(v, W.gravity, d, ty - me.muzzle[1], false);
    if (p > me.def.pitchMax || p < me.def.pitchMin) p = ballisticPitch(v, W.gravity, d, ty - me.muzzle[1], true);
    return p;
  }

  updateLock(dt, W) {
    const L = this.lock;
    if (W.kind !== 'seeker' || this.view !== 'commander' || !this.cam || !this.cam.vp) { L.cand = -1; L.t = 0; L.id = -1; return; }
    const me = this.me;
    let best = -1, bd = 1e9;
    for (const t of this.tanks.values()) {
      if (t === me || !t.net.al || t.net.pw.ghost) continue;
      const d = Math.hypot(t.x - me.x, t.z - me.z);
      if (d > W.range || d < 10) continue;
      const p = m4.transform(this.cam.vp, t.x, t.y + 1.2, t.z, 1);
      if (p[3] <= 0) continue;
      const sx = p[0] / p[3], sy = p[1] / p[3];
      const r = Math.hypot(sx * (this.cam.w / this.cam.h), sy);
      if (r > 0.12) continue;
      if (this.smokes.some((s) => segCircle(me.x, me.z, t.x, t.z, s.x, s.z, s.r * 0.85))) continue;
      if (this.world.segmentBlocked(me.x, me.y + 2, me.z, t.x, t.y + 1.5, t.z)) continue;
      if (r < bd) { bd = r; best = t.id; }
    }
    if (best !== L.cand) { L.cand = best; L.t = 0; L.id = -1; }
    if (best >= 0) {
      L.t += dt;
      if (L.id < 0 && Math.floor(L.t * 8) !== Math.floor((L.t - dt) * 8)) this.sound.play('lockBeep', 0.4);
      if (L.t >= W.lockTime && L.id < 0) { L.id = best; this.sound.play('locked', 0.5); }
      const t = this.tanks.get(best);
      this.lockDist = Math.hypot(t.x - me.x, t.z - me.z);
    }
  }

  /** Distance along the gun until it meets terrain or an obstacle. */
  rangeAlongGun(me) {
    for (let s = 2; s < 400; s += 2) {
      const x = me.muzzle[0] + me.dir[0] * s, y = me.muzzle[1] + me.dir[1] * s, z = me.muzzle[2] + me.dir[2] * s;
      if (y < this.world.heightAt(x, z)) return s;
    }
    return 0;
  }

  pickGround(cam, sx, sy) {
    if (!cam.invVP) return null;
    const nx = ((sx - cam.x) / cam.w) * 2 - 1, ny = -(((sy - cam.y) / cam.h) * 2 - 1);
    const a = m4.transform(cam.invVP, nx, ny, -1, 1), b = m4.transform(cam.invVP, nx, ny, 1, 1);
    const o = [a[0] / a[3], a[1] / a[3], a[2] / a[3]], e = [b[0] / b[3], b[1] / b[3], b[2] / b[3]];
    const d = [e[0] - o[0], e[1] - o[1], e[2] - o[2]];
    const L = Math.hypot(...d); d[0] /= L; d[1] /= L; d[2] /= L;
    let prev = 0;
    for (let s = 1; s < 900; s += 2) {
      const x = o[0] + d[0] * s, y = o[1] + d[1] * s, z = o[2] + d[2] * s;
      if (y < this.world.heightAt(x, z)) {
        let lo = prev, hi = s;
        for (let k = 0; k < 8; k++) { const mid = (lo + hi) / 2; if (o[1] + d[1] * mid < this.world.heightAt(o[0] + d[0] * mid, o[2] + d[2] * mid)) hi = mid; else lo = mid; }
        return [o[0] + d[0] * hi, o[1] + d[1] * hi, o[2] + d[2] * hi];
      }
      prev = s;
    }
    return null;
  }

  /** Track marks, dust, wreck smoke, burning, smoke screens, debris, jets, projectile trails. */
  updateCosmetics(dt, now) {
    const fx = this.fx, W = this.world;
    this.shake = Math.max(0, this.shake - dt * 2.2);
    this.flash = Math.max(0, this.flash - dt * 0.7);
    this.dmgT = Math.max(0, (this.dmgT || 0) - dt);
    this.hitMarkT = Math.max(0, (this.hitMarkT || 0) - dt);
    this.incoming = Math.max(0, this.incoming - dt);
    this.kick = Math.max(0, (this.kick || 0) - dt * 4);
    this.viewFlash = Math.max(0, (this.viewFlash || 0) - dt);
    for (const k of this.killfeed) k.t += dt;
    this.killfeed = this.killfeed.filter((k) => k.t < 6);
    for (const a of this.announce) a.t += dt;
    this.announce = this.announce.filter((a) => a.t < 2.2);
    if (this.state === 'over') this.overT = (this.overT || 0) + dt;
    for (const t of this.tanks.values()) {
      const s = this.sample(t, now);
      const ox = t.x, oz = t.z;
      Object.assign(t, s);
      if (t.id === this.you && t.net.al) { t.ty = this.pred.yaw; t.p = this.pred.pitch; }
      t.flashT = Math.max(0, t.flashT - dt);
      t.recoil = Math.max(0, t.recoil - dt * 3);
      t.rock = Math.max(0, t.rock - dt * 3);
      // terrain normal (same maths as the server)
      const fxv = Math.sin(t.yaw), fzv = Math.cos(t.yaw), rx = Math.cos(t.yaw), rz = -Math.sin(t.yaw);
      const L = 1.7 * t.scale, Wd = 1.1 * t.scale;
      const hF = W.heightAt(t.x + fxv * L, t.z + fzv * L), hB = W.heightAt(t.x - fxv * L, t.z - fzv * L);
      const hR = W.heightAt(t.x + rx * Wd, t.z + rz * Wd), hL = W.heightAt(t.x - rx * Wd, t.z - rz * Wd);
      const df = (hF - hB) / (2 * L) - t.rock * 0.08, dr = (hR - hL) / (2 * Wd);
      const n0 = -df * fxv - dr * rx, n2 = -df * fzv - dr * rz, nl = Math.hypot(n0, 1, n2);
      t.n[0] = n0 / nl; t.n[1] = 1 / nl; t.n[2] = n2 / nl;
      this.tankMatrices(t);
      if (!t.net.al) {
        t.wreckT += dt;
        if (Math.random() < dt * 6) fx.smokeTrail(t.x + (Math.random() - 0.5) * 2, t.y + 1.5, t.z + (Math.random() - 0.5) * 2, 0.6, 0.35);
        if (Math.random() < dt * 4 && t.wreckT < 2) fx.fireTrail(t.x, t.y + 1.2, t.z, 1.2);
        continue;
      }
      const moved = Math.hypot(t.x - ox, t.z - oz);
      if (moved < 5) t.trackAcc += moved;
      if (t.trackAcc > 0.55) {
        t.trackAcc = 0;
        const tw = 1.0 * t.scale;
        fx.trackMark(t.x + rx * tw, t.z + rz * tw, t.yaw, 0.5 * t.scale);
        fx.trackMark(t.x - rx * tw, t.z - rz * tw, t.yaw, 0.5 * t.scale);
        if (Math.abs(t.net.spd) > t.def.speed * 0.6 && Math.random() < 0.5) fx.dust(t.x - fxv * L * 1.2, t.y, t.z - fzv * L * 1.2, 1);
      }
      if (t.net.burn && Math.random() < dt * 20) fx.flame(t.x + (Math.random() - 0.5) * 2, t.y + 1.2, t.z + (Math.random() - 0.5) * 2, 0, 2, 0);
      if (t.net.heat > 2.5 && Math.random() < dt * 6) fx.smokeTrail(t.x, t.y + 2, t.z, 0.3, 0.2);
      if (t.net.hp < t.net.mhp * 0.3 && Math.random() < dt * 18) fx.smokeTrail(t.x, t.y + 1.8, t.z, 0.4, 0.25);
      if (t.net.pw.speed && Math.abs(t.net.spd) > 4 && Math.random() < 0.5) fx.add({ k: 'glow', x: t.x - fxv * 2.5, y: t.y + 1, z: t.z - fzv * 2.5, vx: 0, vy: 0, vz: 0, life: 0.3, s0: 0.5, s1: 0.1, c0: [0.3, 0.9, 1], c1: [0.1, 0.4, 1], a: 0.8 });
    }
    // engine hum for my tank
    const me = this.me;
    if (me && this.sound.ready) this.sound.engine(0, me.net.al && this.state !== 'over', Math.min(1, Math.hypot(me.net.vx, me.net.vz) / me.def.speed), 0.8, 0);
    // projectiles: extrapolate between snapshots and leave trails
    for (const p of this.proj.values()) {
      p.vy -= p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.kind === 'seeker') { fx.smokeTrail(p.x, p.y, p.z, 0.35, 0.9); fx.fireTrail(p.x, p.y, p.z, 0.4); }
      else if (p.kind === 'flare') { fx.add({ k: 'glow', x: p.x, y: p.y, z: p.z, vx: 0, vy: 0, vz: 0, life: 0.4, s0: 0.6, s1: 0.1, c0: [1, 0.3, 0.2], c1: [1, 0.1, 0.1], a: 1 }); if (Math.random() < 0.5) fx.smokeTrail(p.x, p.y, p.z, 0.3, 0.95); }
      else if ((p.kind === 'shell' || p.kind === 'cluster') && Math.random() < 0.6) fx.smokeTrail(p.x, p.y, p.z, WEAPONS[p.w].nuke ? 0.6 : 0.22, 0.85);
      else if (p.kind === 'bomblet' && Math.random() < 0.4) fx.add({ k: 'glow', x: p.x, y: p.y, z: p.z, vx: 0, vy: 0, vz: 0, life: 0.2, s0: 0.3, s1: 0.05, c0: [1, 0.5, 0.9], c1: [1, 0.2, 0.5], a: 1 });
      if (p.kind === 'shell' && WEAPONS[p.w].hv && Math.random() < 0.8) fx.add({ k: 'glow', x: p.x, y: p.y, z: p.z, vx: 0, vy: 0, vz: 0, life: 0.15, s0: 0.35, s1: 0.05, c0: [0.8, 0.95, 1], c1: [0.3, 0.6, 1], a: 1 });
    }
    // smoke screens keep billowing while they live
    for (const s of this.smokes) {
      if (s.age > s.life - 2) continue;
      const rate = 10 * (s.r / 11);
      if (Math.random() < rate * dt * 3) this.fx.smokePuff(s.x, W.heightAt(s.x, s.z), s.z, s.r * 0.75);
    }
    // air strike target markers billow red smoke
    for (const s of this.strikes) if (s.t > 0 && Math.random() < dt * 12) fx.add({ k: 'puff', x: s.x + (Math.random() - 0.5), y: W.heightAt(s.x, s.z) + 0.5, z: s.z + (Math.random() - 0.5), vx: (Math.random() - 0.5), vy: 4 + Math.random() * 2, vz: (Math.random() - 0.5), drag: 0.3, life: 2.5, s0: 0.8, s1: 3.5, c0: [1, 0.25, 0.2], c1: [0.9, 0.6, 0.55], a: 0.85 });
    for (const j of this.jets) { j.age += dt; j.x += j.dx * 120 * dt; j.z += j.dz * 120 * dt; if (Math.random() < 0.8) fx.smokeTrail(j.x - j.dx * 4, j.y, j.z - j.dz * 4, 0.5, 0.95); }
    this.jets = this.jets.filter((j) => j.age < 3);
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.age += dt; d.vy -= 26 * dt;
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt; d.yaw += d.wy * dt; d.pitch += d.wp * dt;
      const g = W.heightAt(d.x, d.z);
      if (d.y < g + 0.3) { d.y = g + 0.3; if (d.vy < -4) { d.vy *= -0.4; d.vx *= 0.6; d.vz *= 0.6; fx.dust(d.x, g, d.z, 3); } else { d.vy = 0; d.vx *= 0.9; d.vz *= 0.9; d.wy *= 0.9; d.wp *= 0.9; } }
      if (Math.random() < dt * 12 && d.age < 3) fx.smokeTrail(d.x, d.y, d.z, 0.5, 0.3);
      if (d.age > 6) this.debris.splice(i, 1);
    }
    for (const p of this.pickups) p.spin += dt;
  }

  tankMatrices(t) {
    const G = t.geom, m = this.m;
    alignToNormal(t.hullM, t.x, t.y, t.z, t.n, t.yaw, t.scale);
    m4.compose(m, 0, G.turretY, 0, t.ty - t.yaw);
    m4.multiply(t.turretM, t.hullM, m);
    m4.compose(m, 0, G.barrelY, G.barrelZ - t.recoil * 0.6, 0, -t.p, 0);
    m4.multiply(t.barrelM, t.turretM, m);
    const b = t.barrelM, L = G.barrelLen;
    t.muzzle[0] = b[12] + b[8] * L; t.muzzle[1] = b[13] + b[9] * L; t.muzzle[2] = b[14] + b[10] * L;
    dirFromYawPitch(t.ty, t.p, t.dir);
  }

  // ---------------- cameras ----------------
  updateCamera(dt) {
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    const v = { x: 0, y: 0, w: W, h: H, kind: this.view };
    const st = this.camState;
    const me = this.me;
    const shk = this.shake * this.shake * 1.6;
    const sx = (Math.random() - 0.5) * shk, sy = (Math.random() - 0.5) * shk, sz = (Math.random() - 0.5) * shk;
    let eye, at, fov = 50, near = 0.5, fog = 0.0016;
    const winner = this.state === 'over' && this.snap && this.snap.win >= 0 ? this.tanks.get(this.snap.win) : null;
    const follow = winner || (me && me.net) ? winner || me : null;
    if (this.state === 'lobby' || this.state === 'connecting' || !this.snap) {
      const a = this.time * 0.05;
      eye = [Math.sin(a) * 110, 70, Math.cos(a) * 110]; at = [0, 0, 0];
      v.kind = 'lobby'; v.camH = 70; v.focus = [0, 0, 0];
    } else if (winner && (this.overT || 0) > 0.4) {
      st.yaw += dt * 0.35;
      eye = [winner.x + Math.sin(st.yaw) * 20, winner.y + 9, winner.z + Math.cos(st.yaw) * 20];
      at = [winner.x, winner.y - 1.5, winner.z];
      v.kind = 'winner'; v.camH = 20; v.focus = [winner.x, winner.y, winner.z];
    } else if (!me) {
      // spectator: high overview of the whole battle
      const list = [...this.tanks.values()].filter((t) => t.net.al);
      let cx = 0, cz = 0;
      for (const t of list) { cx += t.x; cz += t.z; }
      if (list.length) { cx /= list.length; cz /= list.length; }
      const h = this.world.size * 0.55;
      st.fx = lerp(st.fx, cx, Math.min(1, dt)); st.fz = lerp(st.fz, cz, Math.min(1, dt));
      eye = [st.fx, h, st.fz + h * 0.45]; at = [st.fx, 0, st.fz];
      v.kind = 'birdseye'; v.camH = h; v.focus = [st.fx, 0, st.fz]; fov = 45; fog = 0.0008;
    } else if (!me.net.al) {
      st.yaw += dt * 0.4;
      eye = [me.x + Math.sin(st.yaw) * 16, me.y + 7, me.z + Math.cos(st.yaw) * 16];
      at = [me.x, me.y + 1, me.z];
      v.kind = 'dead'; v.focus = [me.x, me.y, me.z]; v.camH = 16;
    } else if (this.view === 'birdseye') {
      const h = this.zoomH;
      const k = st.init ? Math.min(1, dt * 4) : 1;
      st.fx = lerp(st.fx, me.x + me.net.vx * 0.4, k); st.fz = lerp(st.fz, me.z + me.net.vz * 0.4, k); st.fy = lerp(st.fy, me.y, k);
      st.h = lerp(st.h, h, st.init ? Math.min(1, dt * 3) : 1);
      st.init = true;
      eye = [st.fx + sx * 3, st.fy + st.h + sy * 3, st.fz + st.h * 0.45 + sz * 3];
      at = [st.fx + sx * 2, st.fy, st.fz - st.h * 0.02];
      fov = 45; fog = 0.0007;
      v.focus = [st.fx, st.fy, st.fz]; v.camH = st.h;
    } else if (this.view === 'chase') {
      // slightly elevated behind the tank, locked to the turret direction
      const yaw = this.pred.yaw;
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      const back = 13 * me.scale, up = 4.2 * me.scale;
      let ex = me.x - fx * back, ez = me.z - fz * back;
      let ey = me.y + up;
      ey = Math.max(ey, this.world.heightAt(ex, ez) + 2);
      const target = [ex, ey, ez];
      if (!st.eye) st.eye = target.slice();
      const k = Math.min(1, dt * 10);
      for (let i = 0; i < 3; i++) st.eye[i] = lerp(st.eye[i], target[i], k);
      const look = 30;
      const tilt = Math.tan(clamp(this.pred.pitch, -0.2, 0.3)) * look * 0.3;
      eye = [st.eye[0] + sx * 0.4, st.eye[1] + sy * 0.4, st.eye[2] + sz * 0.4];
      at = [me.x + fx * look, me.y + 3.2 + tilt + this.kick * 1.5, me.z + fz * look];
      fov = 60; near = 0.4; fog = 0.0022;
      v.focus = [me.x + fx * 30, me.y, me.z + fz * 30];
    } else {
      // commander: gunner's sight just past the muzzle
      const W = WEAPONS[this.weapon || 'standard'];
      const px = me.muzzle[0] + me.dir[0] * 0.3, py = Math.max(me.muzzle[1] + 0.35 * me.scale, me.y + 2.4), pz = me.muzzle[2] + me.dir[2] * 0.3;
      let dir = me.dir.slice();
      v.impact = null;
      if (W.kind === 'seeker' || W.kind === 'strike' || (W.gravity && me.p > 0.5)) {
        const imp = this.predictImpact(me, W);
        v.impact = imp;
        if (imp) { const dx = imp[0] - px, dy = imp[1] - py, dz = imp[2] - pz, l = Math.hypot(dx, dy, dz); dir = [dx / l, dy / l, dz / l]; }
      }
      eye = [px + sx * 0.15, py + sy * 0.15, pz + sz * 0.15];
      at = [eye[0] + dir[0] * 10, eye[1] + (dir[1] + this.kick * 0.04) * 10, eye[2] + dir[2] * 10];
      fov = this.zoomed ? 58 / me.def.zoom : 58; near = 0.3; fog = 0.0028;
      v.focus = [eye[0] + dir[0] * 40, me.y, eye[2] + dir[2] * 40];
    }
    const view = m4.lookAt(m4.create(), eye[0], eye[1], eye[2], at[0], at[1], at[2]);
    const proj = m4.perspective(m4.create(), (fov * Math.PI) / 180, W / H, near, 1200);
    v.view = view; v.proj = proj;
    v.vp = m4.multiply(m4.create(), proj, view);
    v.invVP = m4.invert(m4.create(), v.vp);
    v.cam = eye; v.fogDensity = fog; v.sky = true;
    const fdx = at[0] - eye[0], fdz = at[2] - eye[2], fl = Math.hypot(fdx, fdz) || 1;
    this.camRight = [-fdz / fl, 0, fdx / fl];
    if (v.kind === 'birdseye' || v.kind === 'lobby' || v.kind === 'winner' || v.kind === 'dead') {
      v.shadowCenter = [v.focus[0], v.focus[1], v.focus[2] - (v.camH || 60) * 0.1];
      v.shadowRadius = Math.min(260, (v.camH || 60) * 1.3);
      this.listen = [v.focus[0], v.focus[2]];
    } else {
      const d = this.zoomed ? 70 : 45;
      v.shadowCenter = [eye[0] + (fdx / fl) * d, me ? me.y : 0, eye[2] + (fdz / fl) * d];
      v.shadowRadius = d + 20;
      this.listen = [eye[0], eye[2]];
    }
    this.cam = v;
    return v;
  }

  predictImpact(t, W) {
    let x = t.muzzle[0], y = t.muzzle[1], z = t.muzzle[2];
    let vx, vy, vz;
    if (W.kind === 'seeker' || W.kind === 'strike') {
      const dist = this.lock.id >= 0 ? this.lockDist : this.aim.range;
      const v = seekerSpeed(dist, W.gravity, W.launchPitch), d = dirFromYawPitch(t.ty, W.launchPitch);
      vx = d[0] * v; vy = d[1] * v; vz = d[2] * v;
    } else {
      const v = W.speed * (W.id === 'standard' ? t.def.gun.speed || 1 : 1);
      vx = t.dir[0] * v; vy = t.dir[1] * v; vz = t.dir[2] * v;
    }
    const h = 1 / 30, g = W.gravity || 0;
    for (let i = 0; i < 600; i++) {
      vy -= g * h; x += vx * h; y += vy * h; z += vz * h;
      const gy = this.world.heightAt(x, z);
      if (y < gy) return [x, gy, z];
    }
    return null;
  }

  // ---------------- rendering ----------------
  render(dt, now) {
    const r = this.renderer;
    const dpr = Math.min(window.devicePixelRatio || 1, this.cfg.quality === 'high' ? 2 : this.cfg.quality === 'low' ? 1 : 1.5);
    r.resize(dpr);
    this.hud.resize(window.devicePixelRatio || 1);
    const v = this.updateCamera(dt);
    for (const mesh of r.meshes) if (!mesh.static) mesh.clear();
    const birds = v.kind === 'birdseye' || v.kind === 'lobby';
    const alive = [...this.tanks.values()].filter((t) => t.net.al).map((t) => ({ x: t.x, z: t.z, alive: true }));
    this.world.drawDynamic(this.time, birds, v.camH || 60, v.focus || [0, 0, 0], birds ? alive : []);
    this.drawTanks(v);
    this.drawProjectiles();
    this.drawPickups();
    this.drawStrikes();
    this.drawAimGuide(v);
    this.fx.draw();
    r.beginFrame(this.time);
    r.renderView(v);
    this.hud.draw(v, dt);
  }

  drawTanks(v) {
    const M = this.M, m = this.m;
    for (const t of this.tanks.values()) {
      const n = t.net;
      if (n.el && !n.al && t.wreckT > 4) continue;
      // in commander view my own tank would only clip the camera
      const own = t.id === this.you && v.kind === 'commander';
      const parts = M.tanks[t.type];
      let [r, g, b] = t.color;
      if (!n.al) { r = g = b = 0.18; }
      if (t.flashT > 0) { r = g = b = 4; }
      if (n.inv > 0 && Math.floor(this.time * 12) % 2 === 0) { r *= 1.8; g *= 1.8; b *= 1.8; }
      if (n.al && n.pw.ghost && Math.floor(this.time * 30) % 3 !== 0) continue;
      if (!own) parts.hull.add(t.hullM, r, g, b);
      if (n.al) {
        if (!own) { parts.turret.add(t.turretM, r, g, b); parts.barrel.add(t.barrelM, r, g, b); }
        alignToNormal(m, t.x, t.y + 0.12, t.z, t.n, 0, t.radius * 1.5, 1, t.radius * 1.5);
        M.teamRing.add(m, t.color[0], t.color[1], t.color[2], 0.75);
        // a beacon over every tank in the high bird's-eye view so the small tanks are easy to spot
        if (v.kind === 'birdseye') { m4.compose(m, t.x, t.y, t.z, 0, 0, 0, 1.2, 9, 1.2); M.beacon.add(m, t.color[0] * 0.5, t.color[1] * 0.5, t.color[2] * 0.5, 1); }
        if (n.sh > 0 || n.inv > 0) {
          m4.compose(m, t.x, t.y + 1.2, t.z, this.time, 0, 0, t.radius * 1.9, t.radius * 1.4, t.radius * 1.9);
          const c = n.sh > 0 ? [0.4, 0.55, 1] : [1, 1, 1];
          M.bubble.add(m, c[0], c[1], c[2], 0.18 + Math.sin(this.time * 8) * 0.06);
        }
      }
    }
    for (const d of this.debris) { m4.compose(m, d.x, d.y, d.z, d.yaw, d.pitch, 0, d.scale); M.tanks[d.type].turret.add(m, 0.22, 0.2, 0.2); }
  }

  drawProjectiles() {
    const M = this.M, m = this.m;
    for (const p of this.proj.values()) {
      const sp = Math.hypot(p.vx, p.vy, p.vz) || 1;
      const yaw = Math.atan2(p.vx, p.vz), pitch = -Math.asin(clamp(p.vy / sp, -1, 1));
      const W = WEAPONS[p.w];
      if (p.kind === 'shell' && W.nuke) M.nukeShell.add(m4.compose(m, p.x, p.y, p.z, yaw, pitch, 0, 0.9));
      else if (p.kind === 'shell' && W.hv) { m4.compose(m, p.x, p.y, p.z, yaw, pitch, 0, 0.12, 0.12, 5); M.spark.add(m, 0.7, 0.95, 1, 1); }
      else if (p.kind === 'shell' || p.kind === 'cluster') { const s = p.kind === 'cluster' ? 1.4 : 1; m4.compose(m, p.x, p.y, p.z, yaw, pitch, 0, 0.22 * s, 0.22 * s, 0.45 * s); M.shell.add(m, p.kind === 'cluster' ? 1.6 : 1, p.kind === 'cluster' ? 0.6 : 1, p.kind === 'cluster' ? 1.4 : 1); M.glow.add(m4.compose(m, p.x, p.y, p.z, 0, 0, 0, 0.35), 1, 0.8, 0.4, 0.6); }
      else if (p.kind === 'bullet') { m4.compose(m, p.x, p.y, p.z, yaw, pitch, 0, 0.08, 0.08, 2.2); M.spark.add(m, 1, 0.95, 0.5, 1); }
      else if (p.kind === 'seeker') M.rocket.add(m4.compose(m, p.x, p.y, p.z, yaw, pitch, 0, 1.4));
      else if (p.kind === 'bomb') M.bomb.add(m4.compose(m, p.x, p.y, p.z, yaw, pitch, 0, 1.3));
      else if (p.kind === 'bomblet') { m4.compose(m, p.x, p.y, p.z, this.time * 5, 0, 0, 0.3); M.shell.add(m, 1.8, 0.5, 1.2); }
      else if (p.kind === 'flare') M.glow.add(m4.compose(m, p.x, p.y, p.z, 0, 0, 0, 0.5), 1, 0.25, 0.2, 1);
    }
    for (const j of this.jets) M.jet.add(m4.compose(m, j.x, j.y, j.z, Math.atan2(j.dx, j.dz), 0, Math.sin(j.age * 3) * 0.1, 1.8));
  }

  drawPickups() {
    const M = this.M, m = this.m;
    for (const p of this.pickups) {
      if (!p.active) continue;
      if (p.temp >= 0 && p.temp < 5 && Math.floor(p.spin * 6) % 2) continue;
      const y = p.y + 1.6 + Math.sin(p.spin * 2.2) * 0.35;
      let col;
      if (p.kind === 'health') { M.health.add(m4.compose(m, p.x, y, p.z, p.spin * 1.2, 0, 0, 1.2)); col = [1, 0.35, 0.35]; }
      else if (p.kind === 'ammo') { M.ammo.add(m4.compose(m, p.x, y, p.z, p.spin * 1.2, 0, 0, 1.5)); col = [1, 0.85, 0.3]; }
      else if (p.kind === 'weapon') { M.wcrate.add(m4.compose(m, p.x, y, p.z, p.spin * 1.2, 0, 0, p.sub === 'massive' ? 1.9 : 1.5)); col = p.sub === 'massive' ? [1, 0.9, 0.1] : [1, 0.6, 0.2]; }
      else { const P = POWERUPS[p.sub]; col = P.color; M.gem.add(m4.compose(m, p.x, y + 0.3, p.z, p.spin * 2, 0, 0, 1.5), col[0] * 1.3, col[1] * 1.3, col[2] * 1.3); M.glow.add(m4.compose(m, p.x, y + 0.3, p.z, 0, 0, 0, 1.5 + Math.sin(p.spin * 6) * 0.2), col[0], col[1], col[2], 0.35); }
      const n = this.world.normalAt(p.x, p.z, [0, 1, 0]);
      alignToNormal(m, p.x, p.y + 0.1, p.z, n, p.spin, 2.2, 1, 2.2);
      M.teamRing.add(m, col[0], col[1], col[2], 0.6 + Math.sin(p.spin * 4) * 0.2);
      m4.compose(m, p.x, p.y + 0.1, p.z, p.spin * 0.5, 0, 0, 1.1, 10 + Math.sin(p.spin * 3) * 1.2, 1.1);
      M.beacon.add(m, col[0] * 0.4, col[1] * 0.4, col[2] * 0.4, 1);
    }
    for (const d of this.drops) {
      const sw = Math.sin(this.time * 1.5 + d.id) * 0.15;
      M.wcrate.add(m4.compose(m, d.x, d.y, d.z, this.time * 0.3, 0, sw, 1.2));
      M.chute.add(m4.compose(m, d.x - Math.sin(sw) * 5, d.y + 5, d.z, this.time * 0.3, 0, sw, 1.2), 1, 0.3, 0.3);
      alignToNormal(m, d.x, d.gy + 0.15, d.z, [0, 1, 0], this.time, 3, 1, 3);
      M.teamRing.add(m, 1, 0.85, 0.3, 0.5 + Math.sin(this.time * 6) * 0.3);
    }
  }

  drawStrikes() {
    const M = this.M, m = this.m;
    for (const s of this.strikes) {
      if (s.t <= -0.5) continue;
      const g = this.world.heightAt(s.x, s.z);
      const pulse = 0.55 + Math.sin(this.time * (s.t < 2 ? 18 : 8)) * 0.35;
      alignToNormal(m, s.x, g + 0.3, s.z, [0, 1, 0], 0, s.r, 1, s.r);
      M.teamRing.add(m, 1, 0.15, 0.1, pulse);
      alignToNormal(m, s.x, g + 0.25, s.z, [0, 1, 0], this.time, s.r * 0.5, 1, s.r * 0.5);
      M.teamRing.add(m, 1, 0.3, 0.2, pulse * 0.6);
      M.decal.add(alignToNormal(m, s.x, g + 0.2, s.z, [0, 1, 0], 0, s.r, 1, s.r), 1, 0.1, 0.05, 0.12);
      m4.compose(m, s.x, g, s.z, this.time, 0, 0, 2, 60, 2);
      M.beacon.add(m, 0.9, 0.12, 0.08, 1);
    }
  }

  /** Bird's-eye: dotted trajectory and impact ring for the current weapon. */
  drawAimGuide(v) {
    const me = this.me;
    if (!me || !me.net.al || v.kind === 'commander' || this.state === 'over') return;
    const M = this.M, m = this.m;
    const W = WEAPONS[this.weapon || 'standard'];
    if (W.kind === 'flame') return;
    let x = me.muzzle[0], y = me.muzzle[1], z = me.muzzle[2], vx, vy, vz;
    if (W.kind === 'seeker' || W.kind === 'strike') {
      const dist = this.aim.range, sp = seekerSpeed(dist, W.gravity, W.launchPitch), d = dirFromYawPitch(me.ty, W.launchPitch);
      vx = d[0] * sp; vy = d[1] * sp; vz = d[2] * sp;
    } else {
      const sp = W.speed * (W.id === 'standard' ? me.def.gun.speed || 1 : 1);
      vx = me.dir[0] * sp; vy = me.dir[1] * sp; vz = me.dir[2] * sp;
    }
    const g = W.gravity || 0;
    const maxLen = W.kind === 'bullet' ? 80 : 500;
    let dist = 0, i = 0, end = null;
    const step = v.kind === 'birdseye' ? 3 : 2;
    while (dist < maxLen && i++ < 300) {
      const vl = Math.hypot(vx, vy, vz), h = step / vl;
      const nx = x + vx * h, ny = y + vy * h, nz = z + vz * h;
      vy -= g * h;
      const gh = this.world.heightAt(nx, nz);
      if (ny < gh) { end = [nx, gh, nz]; break; }
      if (i % 2 === 0) {
        const dx = nx - x, dy = ny - y, dz = nz - z, L = Math.hypot(dx, dy, dz);
        M.dash.add(m4.compose(m, x, y, z, Math.atan2(dx, dz), -Math.asin(dy / L), 0, v.kind === 'birdseye' ? 0.3 : 0.08, v.kind === 'birdseye' ? 0.3 : 0.08, L), me.color[0] * 1.2, me.color[1] * 1.2, me.color[2] * 1.2, (v.kind === 'birdseye' ? 0.6 : 0.35) * (1 - dist / maxLen) + 0.1);
      }
      x = nx; y = ny; z = nz; dist += step;
    }
    this.aimEnd = end;
    if (end) {
      const R = W.kind === 'strike' ? W.radius : W.kind === 'cluster' ? W.spreadR : W.splash || 2;
      alignToNormal(m, end[0], end[1] + 0.15, end[2], this.world.normalAt(end[0], end[2], [0, 1, 0]), this.time, R, 1, R);
      M.teamRing.add(m, me.color[0], me.color[1], me.color[2], 0.7);
    }
  }
}

function segCircle(x0, z0, x1, z1, cx, cz, r) {
  const dx = x1 - x0, dz = z1 - z0, L2 = dx * dx + dz * dz || 1;
  const u = clamp(((cx - x0) * dx + (cz - z0) * dz) / L2, 0, 1);
  return Math.hypot(x0 + dx * u - cx, z0 + dz * u - cz) < r;
}

function safeStore(k, v) {
  try {
    if (v === undefined) return localStorage.getItem(k);
    localStorage.setItem(k, v);
  } catch { /* storage unavailable (private mode) */ }
  return null;
}
