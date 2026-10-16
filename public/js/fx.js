// Particle effects: fireballs, smoke, sparks, debris, shockwaves, scorch marks, track marks and comic pop-text.
import { m4, alignToNormal, clamp, lerp } from './math.js';

const BOOM_WORDS = ['BOOM!', 'KABOOM!', 'POW!', 'BLAM!', 'KA-BLAM!', 'WHAM!', 'BOOM!'];
const TEXT_COLS = ['#ffdd33', '#ff7a2f', '#ff4f8b', '#66e0ff', '#a6ff4d'];
const CONFETTI = [[1, 0.36, 0.55], [1, 0.84, 0.2], [0.42, 0.8, 1], [0.6, 0.9, 0.35], [0.78, 0.55, 1], [1, 0.6, 0.2], [1, 1, 1]];

export class FX {
  constructor(models, world) {
    this.M = models;
    this.world = world;
    this.parts = [];
    this.decals = [];
    this.tracks = [];
    this.texts = [];
    this.m = m4.create();
    this.n = [0, 1, 0];
    this.maxParts = 2500;
  }

  add(p) {
    if (this.parts.length >= this.maxParts) return;
    p.age = 0;
    this.parts.push(p);
  }

  /** Big fun explosion. size ~1 for a shell, 2-3 for tanks/barrels. */
  explode(x, y, z, size = 1, opts = {}) {
    const R = Math.random;
    const s = size;
    // quick bright flash (additive, kept dim enough not to blow out to white)
    this.add({ k: 'glow', x, y: y + 0.5, z, vx: 0, vy: 0, vz: 0, life: 0.1, s0: 2.0 * s, s1: 3.6 * s, c0: [0.7, 0.55, 0.25], c1: [0.5, 0.25, 0.05], a: 1 });
    // chunky cartoon fireballs: solid yellow cores rolling out into orange and red, then into smoke
    const nFire = Math.round(7 + 6 * s);
    for (let i = 0; i < nFire; i++) {
      const a = R() * Math.PI * 2, e = R() * 0.9 + 0.2, sp = (3 + R() * 6) * s;
      this.add({ k: 'fire', x, y: y + 0.5, z, vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp * 0.9 + 2, vz: Math.sin(a) * Math.cos(e) * sp, drag: 3.5, rise: 2,
        life: 0.45 + R() * 0.45, s0: (0.9 + R() * 0.8) * s, s1: (1.7 + R() * 1.1) * s, c0: [1, 0.92, 0.35], c1: [0.85, 0.18, 0.05], a: 1 });
    }
    for (let i = 0; i < 3; i++) this.add({ k: 'fire', x: x + (R() - 0.5) * s, y: y + 0.8, z: z + (R() - 0.5) * s, vx: 0, vy: 3 + R() * 2, vz: 0, drag: 2, life: 0.35, s0: 1.6 * s, s1: 2.4 * s, c0: [1, 1, 0.75], c1: [1, 0.55, 0.1], a: 1 });
    // one big white poof, then a ring of puffy cartoon smoke balls
    this.add({ k: 'puff', x, y: y + 0.8, z, vx: 0, vy: 1, vz: 0, life: 0.4, s0: 1.2 * s, s1: 4.2 * s, c0: [1, 1, 1], c1: [1, 0.98, 0.92], a: 0.85 });
    const nSmoke = Math.round(6 + 7 * s);
    for (let i = 0; i < nSmoke; i++) {
      const a = R() * Math.PI * 2, sp = (1 + R() * 3) * s;
      const g = 0.86 + R() * 0.12;
      this.add({ k: 'puff', x: x + Math.cos(a) * s, y: y + 0.6 + R() * s, z: z + Math.sin(a) * s, vx: Math.cos(a) * sp, vy: 2 + R() * 3 * s, vz: Math.sin(a) * sp, drag: 1.5, rise: 1.2,
        life: 1.2 + R() * 1.2, s0: (0.8 + R() * 0.6) * s, s1: (2.2 + R() * 1.6) * s, c0: [g, g, g * 0.97], c1: [1, 1, 1], a: 0.8, delay: 0.08 + R() * 0.15 });
    }
    // tumbling confetti cubes
    const nConf = Math.round(10 + 14 * s);
    for (let i = 0; i < nConf; i++) {
      const a = R() * Math.PI * 2, sp = (3 + R() * 6) * Math.sqrt(s);
      this.add({ k: 'chunk', x, y: y + 1, z, vx: Math.cos(a) * sp, vy: 8 + R() * 8 * Math.sqrt(s), vz: Math.sin(a) * sp, grav: 11, drag: 1.4, life: 1.6 + R() * 1.2,
        s0: 0.16 + R() * 0.14, flat: 0.45, rx: R() * 6, ry: R() * 6, wx: (R() - 0.5) * 22, wy: (R() - 0.5) * 22, c0: CONFETTI[Math.floor(R() * CONFETTI.length)], bounce: false });
    }
    const nSpark = Math.round(10 + 14 * s);
    for (let i = 0; i < nSpark; i++) {
      const a = R() * Math.PI * 2, sp = (10 + R() * 18) * Math.sqrt(s);
      this.add({ k: 'spark', x, y: y + 0.5, z, vx: Math.cos(a) * sp * 0.7, vy: (0.4 + R()) * sp * 0.7, vz: Math.sin(a) * sp * 0.7, grav: 22, life: 0.4 + R() * 0.5, w: 0.09, len: 0.9, c0: [1, 0.95, 0.6], c1: [1, 0.4, 0.1], a: 1 });
    }
    const nChunk = Math.round(3 + 4 * s);
    const ground = this.world.heightAt(x, z);
    const dirtC = ground > -0.8 ? [0.62, 0.42, 0.25] : [0.85, 0.8, 0.6];
    for (let i = 0; i < nChunk; i++) {
      const a = R() * Math.PI * 2, sp = 4 + R() * 8 * s;
      const deb = opts.debrisCol && R() < 0.6;
      // debris tumbles as blocks; earth flies out as round dirt balls
      this.add({ k: deb ? 'chunk' : 'ball', x, y: y + 0.6, z, vx: Math.cos(a) * sp, vy: 7 + R() * 9 * s, vz: Math.sin(a) * sp, grav: 26, life: 1.6 + R(), s0: (0.25 + R() * 0.35) * Math.sqrt(s), rx: R() * 6, ry: R() * 6, wx: (R() - 0.5) * 18, wy: (R() - 0.5) * 18, c0: deb ? opts.debrisCol : dirtC, bounce: true });
    }
    for (let i = 0; i < 4 + 3 * s; i++) {
      const a = R() * Math.PI * 2, sp = 2 + R() * 4 * s;
      const k = 0.85 + R() * 0.25;
      this.add({ k: 'ball', x, y: y + 0.3, z, vx: Math.cos(a) * sp, vy: 5 + R() * 5, vz: Math.sin(a) * sp, grav: 24, life: 1.2 + R() * 0.6, s0: (0.18 + R() * 0.2) * Math.sqrt(s), rx: 0, ry: 0, wx: 0, wy: 0, c0: [dirtC[0] * k, dirtC[1] * k, dirtC[2] * k], bounce: true });
    }
    this.add({ k: 'shock', x, y: Math.max(ground, y - 0.5) + 0.25, z, life: 0.45, s0: 0.6 * s, s1: 9 * s, c0: [1, 0.85, 0.5], a: 0.8 });
    if (y - ground < 2.5) this.scorch(x, z, 2.2 * s);
    if (opts.text || (s >= 1.6 && R() < 0.85) || R() < 0.12) this.popText(x, y + 3 * s, z, opts.text || BOOM_WORDS[Math.floor(R() * BOOM_WORDS.length)], 1 + s * 0.35);
  }

  /** Smaller puff for bullet hits. */
  impact(x, y, z, col = [1, 0.9, 0.5], n = 6) {
    const R = Math.random;
    for (let i = 0; i < n; i++) {
      const a = R() * Math.PI * 2, sp = 4 + R() * 8;
      this.add({ k: 'spark', x, y, z, vx: Math.cos(a) * sp, vy: 3 + R() * 7, vz: Math.sin(a) * sp, grav: 20, life: 0.25 + R() * 0.25, w: 0.06, len: 0.5, c0: col, c1: [1, 0.4, 0.1], a: 1 });
    }
    this.add({ k: 'puff', x, y, z, vx: 0, vy: 1.5, vz: 0, life: 0.5, s0: 0.3, s1: 1.2, c0: [0.98, 0.96, 0.9], c1: [1, 1, 1], a: 0.8 });
  }

  muzzle(x, y, z, dx, dy, dz, size = 1, col = [1, 0.85, 0.4], smoke = true) {
    const R = Math.random;
    this.add({ k: 'glow', x: x + dx * 0.4, y: y + dy * 0.4, z: z + dz * 0.4, vx: dx * 4, vy: dy * 4, vz: dz * 4, life: 0.09, s0: 0.7 * size, s1: 1.1 * size, c0: [1, 1, 0.8], c1: col, a: 1 });
    if (smoke) for (let i = 0; i < 2 * size; i++) {
      const sp = 5 + R() * 5;
      this.add({ k: 'puff', x: x + dx, y: y + dy, z: z + dz, vx: dx * sp + (R() - 0.5) * 2, vy: dy * sp + 1.2, vz: dz * sp + (R() - 0.5) * 2, drag: 2.5, rise: 0.8, life: 0.5 + R() * 0.4, s0: 0.25 * size, s1: 1.0 * size, c0: [0.9, 0.9, 0.9], c1: [0.95, 0.95, 0.95], a: 0.35 });
    }
  }

  splash(x, z, size = 1) {
    const R = Math.random;
    const y = -1.2;
    for (let i = 0; i < 14 * size; i++) {
      const a = R() * Math.PI * 2, sp = 2 + R() * 4;
      this.add({ k: 'puff', x, y, z, vx: Math.cos(a) * sp, vy: 7 + R() * 9 * size, vz: Math.sin(a) * sp, grav: 22, life: 0.7 + R() * 0.4, s0: 0.35 * size, s1: 0.2, c0: [0.85, 0.95, 1], c1: [1, 1, 1], a: 0.9 });
    }
    this.add({ k: 'shock', x, y: y + 0.12, z, life: 0.9, s0: 0.5, s1: 5 * size, c0: [0.85, 0.95, 1], a: 0.7 });
  }

  leaves(x, y, z, col, n = 10) {
    const R = Math.random;
    for (let i = 0; i < n; i++) {
      const a = R() * Math.PI * 2, sp = 2 + R() * 5;
      this.add({ k: 'chunk', x, y: y + R(), z, vx: Math.cos(a) * sp, vy: 4 + R() * 5, vz: Math.sin(a) * sp, grav: 9, drag: 1.8, life: 1.2 + R(), s0: 0.22, rx: R() * 6, ry: R() * 6, wx: (R() - 0.5) * 12, wy: (R() - 0.5) * 12, c0: col, bounce: false });
    }
  }

  dust(x, y, z, n = 1, col = [0.75, 0.68, 0.52]) {
    const R = Math.random;
    for (let i = 0; i < n; i++) this.add({ k: 'puff', x: x + (R() - 0.5), y: y + 0.2, z: z + (R() - 0.5), vx: (R() - 0.5) * 1.5, vy: 0.8 + R(), vz: (R() - 0.5) * 1.5, drag: 1, life: 0.6 + R() * 0.5, s0: 0.3, s1: 1.2, c0: col, c1: col, a: 0.4 });
  }

  smokeTrail(x, y, z, size = 0.35, dark = 0.8) {
    this.add({ k: 'puff', x, y, z, vx: 0, vy: 0.6, vz: 0, life: 0.7, s0: size, s1: size * 3, c0: [dark, dark, dark], c1: [0.85, 0.85, 0.85], a: 0.6 });
  }

  fireTrail(x, y, z, size = 0.3) {
    this.add({ k: 'glow', x, y, z, vx: 0, vy: 0, vz: 0, life: 0.15, s0: size, s1: size * 0.3, c0: [1, 0.9, 0.4], c1: [1, 0.3, 0.05], a: 1 });
  }

  flame(x, y, z, vx, vy, vz) {
    const R = Math.random;
    this.add({ k: 'glow', x, y, z, vx, vy, vz, drag: 1.2, rise: 2.5, life: 0.5 + R() * 0.15, s0: 0.35, s1: 2.2, c0: [1, 0.95, 0.5], c1: [0.9, 0.15, 0.02], a: 0.9 });
  }

  scorch(x, z, r) {
    const n = this.world.normalAt(x, z, [0, 1, 0]);
    this.decals.push({ x, z, y: this.world.heightAt(x, z) + 0.06, r, n, age: 0, life: 30, yaw: Math.random() * 6 });
    if (this.decals.length > 120) this.decals.shift();
  }

  trackMark(x, z, yaw, w = 0.55) {
    const n = this.world.normalAt(x, z, [0, 1, 0]);
    this.tracks.push({ x, z, y: this.world.heightAt(x, z) + 0.05, yaw, n, age: 0, w });
    if (this.tracks.length > 1600) this.tracks.splice(0, 100);
  }

  popText(x, y, z, text, scale = 1, col = null, force = false) {
    // avoid stacking several words on the same spot
    if (!force && this.texts.some((t) => !t.small && t.age < 0.8 && Math.hypot(t.x - x, t.z - z) < 8)) return;
    x += (Math.random() - 0.5) * 3; z += (Math.random() - 0.5) * 3;
    this.texts.push({ x, y, z, text, scale, age: 0, life: 1.1, col: col || TEXT_COLS[Math.floor(Math.random() * TEXT_COLS.length)], rot: (Math.random() - 0.5) * 0.4 });
    if (this.texts.length > 20) this.texts.shift();
  }

  update(dt) {
    const W = this.world;
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      if (p.delay > 0) { p.delay -= dt; continue; }
      p.age += dt;
      if (p.age >= p.life) { this.parts[i] = this.parts[this.parts.length - 1]; this.parts.pop(); continue; }
      if (p.drag) { const d = Math.exp(-p.drag * dt); p.vx *= d; p.vy *= d; p.vz *= d; }
      if (p.grav) p.vy -= p.grav * dt;
      if (p.rise) p.vy += p.rise * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.k === 'chunk' || p.k === 'ball') {
        p.rx += p.wx * dt; p.ry += p.wy * dt;
        const g = W.heightAt(p.x, p.z);
        if (p.y < g + p.s0 * 0.5) {
          p.y = g + p.s0 * 0.5;
          if (p.bounce && p.vy < -3) { p.vy *= -0.35; p.vx *= 0.6; p.vz *= 0.6; } else { p.vy = 0; p.vx *= 0.8; p.vz *= 0.8; p.wx *= 0.8; p.wy *= 0.8; }
        }
      } else if (p.k === 'spark' || p.k === 'puff' || p.k === 'fire') {
        const g = W.heightAt(p.x, p.z);
        if (p.y < g) { p.y = g; p.vy = Math.abs(p.vy) * 0.2; }
      }
    }
    for (let i = this.decals.length - 1; i >= 0; i--) { const d = this.decals[i]; d.age += dt; if (d.age > d.life) this.decals.splice(i, 1); }
    for (const t of this.tracks) t.age += dt;
    while (this.tracks.length && this.tracks[0].age > 9) this.tracks.shift();
    for (let i = this.texts.length - 1; i >= 0; i--) { const t = this.texts[i]; t.age += dt; t.y += dt * 2; if (t.age > t.life) this.texts.splice(i, 1); }
  }

  draw() {
    const M = this.M, m = this.m;
    for (const p of this.parts) {
      if (p.delay > 0) continue;
      const t = p.age / p.life;
      if (p.k === 'glow' || p.k === 'puff' || p.k === 'fire') {
        const s = lerp(p.s0, p.s1, Math.sqrt(t));
        const c0 = p.c0, c1 = p.c1;
        const r = lerp(c0[0], c1[0], t), g = lerp(c0[1], c1[1], t), b = lerp(c0[2], c1[2], t);
        const a = p.a * (p.k === 'puff' ? 1 - t : p.k === 'fire' ? (t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3) : 1 - t * t);
        const sc = p.k === 'fire' && t > 0.75 ? s * (1 - (t - 0.75) * 2) : s;
        m4.compose(m, p.x, p.y, p.z, p.age * 2, p.age, 0, sc);
        (p.k === 'glow' ? M.glow : p.k === 'fire' ? M.fire : M.puff).add(m, r, g, b, a);
      } else if (p.k === 'spark') {
        const sp = Math.hypot(p.vx, p.vy, p.vz) || 1;
        const yaw = Math.atan2(p.vx, p.vz), pitch = -Math.asin(clamp(p.vy / sp, -1, 1));
        const len = p.len * clamp(sp / 12, 0.3, 2);
        m4.compose(m, p.x, p.y, p.z, yaw, pitch, 0, p.w, p.w, len);
        M.spark.add(m, lerp(p.c0[0], p.c1[0], t), lerp(p.c0[1], p.c1[1], t), lerp(p.c0[2], p.c1[2], t), 1 - t);
      } else if (p.k === 'chunk' || p.k === 'ball') {
        const s = p.s0 * (t > 0.8 ? (1 - t) * 5 : 1);
        m4.compose(m, p.x, p.y, p.z, p.ry, p.rx, 0, s, s * (p.flat || 1), s);
        (p.k === 'ball' ? M.ball : M.chunk).add(m, p.c0[0], p.c0[1], p.c0[2], 1);
      } else if (p.k === 'shock') {
        const s = lerp(p.s0, p.s1, Math.sqrt(t));
        m4.compose(m, p.x, p.y, p.z, 0, 0, 0, s, 1, s);
        M.shock.add(m, p.c0[0], p.c0[1], p.c0[2], p.a * (1 - t));
      }
    }
    for (const d of this.decals) {
      const a = 0.4 * (1 - clamp((d.age - d.life + 6) / 6, 0, 1));
      alignToNormal(m, d.x, d.y, d.z, d.n, d.yaw, d.r, 1, d.r);
      M.decal.add(m, 0.32, 0.22, 0.13, a);
    }
    for (const t of this.tracks) {
      const a = 0.22 * (1 - t.age / 9);
      alignToNormal(m, t.x, t.y, t.z, t.n, t.yaw, t.w, 1, 0.42);
      M.track.add(m, 0.25, 0.2, 0.12, a);
    }
  }
}
