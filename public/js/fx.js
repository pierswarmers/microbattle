// Particle effects: fireballs, smoke, sparks, debris, shockwaves, scorch marks, track marks and comic pop-text.
import { m4, alignToNormal, clamp, lerp } from './math.js';

const BOOM_WORDS = ['BOOM!', 'KABOOM!', 'POW!', 'BLAM!', 'KA-BLAM!', 'WHAM!', 'BOOM!'];
const TEXT_COLS = ['#ffdd33', '#ff7a2f', '#ff4f8b', '#66e0ff', '#a6ff4d'];

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
    const nSmoke = Math.round(6 + 7 * s);
    for (let i = 0; i < nSmoke; i++) {
      const a = R() * Math.PI * 2, sp = (1 + R() * 3) * s;
      const g = 0.25 + R() * 0.2;
      this.add({ k: 'puff', x: x + Math.cos(a) * s, y: y + 0.6 + R() * s, z: z + Math.sin(a) * s, vx: Math.cos(a) * sp, vy: 2 + R() * 3 * s, vz: Math.sin(a) * sp, drag: 1.5, rise: 1.2,
        life: 1.4 + R() * 1.6, s0: (0.8 + R() * 0.6) * s, s1: (2.4 + R() * 1.8) * s, c0: [g + 0.1, g + 0.1, g + 0.1], c1: [0.7, 0.7, 0.7], a: 0.7, delay: 0.08 + R() * 0.15 });
    }
    const nSpark = Math.round(10 + 14 * s);
    for (let i = 0; i < nSpark; i++) {
      const a = R() * Math.PI * 2, sp = (10 + R() * 18) * Math.sqrt(s);
      this.add({ k: 'spark', x, y: y + 0.5, z, vx: Math.cos(a) * sp * 0.7, vy: (0.4 + R()) * sp * 0.7, vz: Math.sin(a) * sp * 0.7, grav: 22, life: 0.4 + R() * 0.5, w: 0.09, len: 0.9, c0: [1, 0.95, 0.6], c1: [1, 0.4, 0.1], a: 1 });
    }
    const nChunk = Math.round(3 + 4 * s);
    const ground = this.world.heightAt(x, z);
    const dirtC = ground > -0.8 ? [0.45, 0.33, 0.2] : [0.85, 0.8, 0.6];
    for (let i = 0; i < nChunk; i++) {
      const a = R() * Math.PI * 2, sp = 4 + R() * 8 * s;
      const c = opts.debrisCol && R() < 0.6 ? opts.debrisCol : dirtC;
      this.add({ k: 'chunk', x, y: y + 0.6, z, vx: Math.cos(a) * sp, vy: 7 + R() * 9 * s, vz: Math.sin(a) * sp, grav: 26, life: 1.6 + R(), s0: (0.25 + R() * 0.35) * Math.sqrt(s), rx: R() * 6, ry: R() * 6, wx: (R() - 0.5) * 18, wy: (R() - 0.5) * 18, c0: c, bounce: true });
    }
    this.add({ k: 'shock', x, y: Math.max(ground, y - 0.5) + 0.25, z, life: 0.45, s0: 0.6 * s, s1: 9 * s, c0: [1, 0.85, 0.5], a: 0.8 });
    if (y - ground < 2.5) this.scorch(x, z, 2.2 * s);
    if (!opts.noText && (opts.text || (s >= 1.6 && R() < 0.85) || R() < 0.12)) this.popText(x, y + 3 * s, z, opts.text || BOOM_WORDS[Math.floor(R() * BOOM_WORDS.length)], 1 + s * 0.35);
  }

  /** MASSIVE: blinding flash, rolling fireball, a solid rising stem and a mushroom cap that cools to smoke. */
  nuke(x, y, z) {
    const R = Math.random;
    const g = this.world.heightAt(x, z);
    this.add({ k: 'glow', x, y: g + 6, z, vx: 0, vy: 0, vz: 0, life: 0.4, s0: 16, s1: 40, c0: [1, 1, 0.95], c1: [1, 0.85, 0.5], a: 1 });
    // fireball at the base
    for (let i = 0; i < 16; i++) {
      const a = R() * Math.PI * 2, sp = 3 + R() * 5;
      this.add({ k: 'fire', x: x + Math.cos(a) * 3, y: g + 3 + R() * 4, z: z + Math.sin(a) * 3, vx: Math.cos(a) * sp, vy: 3 + R() * 4, vz: Math.sin(a) * sp, drag: 1.4, rise: 2, life: 2.2 + R() * 0.8, s0: 6, s1: 10 + R() * 4, c0: [1, 1, 0.75], c1: [0.9, 0.3, 0.08], a: 1 });
    }
    // stem: a solid column of fire puffs climbing to the cap
    for (let i = 0; i < 42; i++) {
      const h = (i / 42) * 30;
      this.add({ k: 'fire', x: x + (R() - 0.5) * 3, y: g + 2 + h * 0.3, z: z + (R() - 0.5) * 3, vx: (R() - 0.5) * 0.6, vy: 9 + h * 0.15, vz: (R() - 0.5) * 0.6, drag: 0.6, life: 3.4 + R() * 0.8,
        s0: 3.8 - h * 0.03, s1: 4.8 - h * 0.04, c0: [1, 0.92 - h * 0.012, 0.55 - h * 0.012], c1: [0.75, 0.25, 0.08], a: 1, delay: i * 0.025 });
    }
    // cap: rings of puffs rolling outward, hot inside and cooler at the edge
    for (let ring = 0; ring < 3; ring++) {
      const n = 14 + ring * 6;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + ring * 0.3, rr = 3 + ring * 4, sp = 2.5 + ring * 1.5;
        const hot = ring === 0;
        this.add({ k: 'fire', x: x + Math.cos(a) * rr, y: g + 30 + ring * 1.5 + R() * 2, z: z + Math.sin(a) * rr, vx: Math.cos(a) * sp, vy: 1 + (2 - ring) * 0.8, vz: Math.sin(a) * sp, drag: 0.5, life: 4.2 + R() * 1.2,
          s0: 4 + ring, s1: 8 + ring * 2 + R() * 2, c0: hot ? [1, 0.95, 0.6] : ring === 1 ? [1, 0.6, 0.2] : [0.85, 0.35, 0.15], c1: [0.55, 0.22, 0.12], a: 1, delay: 0.9 + ring * 0.12 + R() * 0.2 });
      }
    }
    // the cooled cloud lingers as soft smoke once the fire has shrunk away
    for (let i = 0; i < 26; i++) {
      const a = R() * Math.PI * 2, rr = R() * 14;
      this.add({ k: 'puff', x: x + Math.cos(a) * rr, y: g + 30 + R() * 6, z: z + Math.sin(a) * rr, vx: Math.cos(a) * 2, vy: 0.6, vz: Math.sin(a) * 2, drag: 0.3, life: 6 + R() * 2, s0: 7, s1: 13, c0: [0.62, 0.55, 0.52], c1: [0.85, 0.83, 0.82], a: 0.85, delay: 3.2 + R() * 0.6 });
    }
    for (let i = 0; i < 12; i++) this.add({ k: 'puff', x: x + (R() - 0.5) * 3, y: g + 4 + i * 2.3, z: z + (R() - 0.5) * 3, vx: 0, vy: 0.8, vz: 0, life: 5 + R(), s0: 3.5, s1: 5, c0: [0.6, 0.55, 0.52], c1: [0.82, 0.8, 0.78], a: 0.8, delay: 3 + i * 0.05 });
    // shockwaves, a low racing dust skirt and debris thrown up in arcs
    this.add({ k: 'shock', x, y: g + 0.4, z, life: 1.3, s0: 4, s1: 90, c0: [1, 0.9, 0.7], a: 1 });
    this.add({ k: 'shock', x, y: g + 0.6, z, life: 1.8, s0: 3, s1: 60, c0: [1, 0.6, 0.3], a: 0.9, delay: 0.15 });
    this.add({ k: 'shock', x, y: g + 31, z, life: 1.6, s0: 6, s1: 36, c0: [1, 1, 1], a: 0.7, delay: 1.0 });
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2, sp = 24 + R() * 12;
      this.add({ k: 'puff', x: x + Math.cos(a) * 6, y: g + 0.8, z: z + Math.sin(a) * 6, vx: Math.cos(a) * sp, vy: 0.5, vz: Math.sin(a) * sp, drag: 1.6, life: 2 + R(), s0: 1.8, s1: 4, c0: [0.8, 0.7, 0.55], c1: [0.88, 0.84, 0.76], a: 0.7 });
    }
    for (let i = 0; i < 34; i++) {
      const a = R() * Math.PI * 2, sp = 10 + R() * 22;
      this.add({ k: 'chunk', x, y: g + 2, z, vx: Math.cos(a) * sp, vy: 14 + R() * 20, vz: Math.sin(a) * sp, grav: 26, life: 3 + R(), s0: 0.4 + R() * 0.6, rx: R() * 6, ry: R() * 6, wx: (R() - 0.5) * 18, wy: (R() - 0.5) * 18, c0: [0.4, 0.3, 0.2], bounce: true });
      if (i % 3 === 0) this.add({ k: 'spark', x, y: g + 2, z, vx: Math.cos(a) * sp, vy: 16 + R() * 18, vz: Math.sin(a) * sp, grav: 22, life: 1.4, w: 0.25, len: 2, c0: [1, 0.9, 0.5], c1: [1, 0.3, 0.05], a: 1 });
    }
    this.scorch(x, z, 18);
    this.popText(x, g + 22, z, 'KA-BOOOOM!', 2.6, '#ffdd33', true);
  }

  /** Cluster shell pops open: bright pop and a fan of glittering sparks. */
  clusterBurst(x, y, z) {
    const R = Math.random;
    const cols = [[1, 0.4, 0.8], [0.6, 0.5, 1], [1, 0.85, 0.3], [0.4, 1, 0.8]];
    this.add({ k: 'glow', x, y, z, vx: 0, vy: 0, vz: 0, life: 0.15, s0: 1.5, s1: 3.5, c0: [1, 0.9, 1], c1: [1, 0.4, 0.8], a: 1 });
    for (let i = 0; i < 26; i++) {
      const a = R() * Math.PI * 2, e = R() * 1.2 - 0.3, sp = 8 + R() * 10;
      const c = cols[i % cols.length];
      this.add({ k: 'spark', x, y, z, vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp, vz: Math.sin(a) * Math.cos(e) * sp, grav: 14, drag: 1, life: 0.6 + R() * 0.4, w: 0.12, len: 0.6, c0: [1, 1, 1], c1: c, a: 1 });
    }
    this.add({ k: 'shock', x, y, z, life: 0.35, s0: 0.5, s1: 7, c0: [1, 0.6, 0.9], a: 0.8 });
    this.add({ k: 'puff', x, y, z, vx: 0, vy: 1, vz: 0, life: 1.4, s0: 1, s1: 3, c0: [0.9, 0.85, 0.95], c1: [0.95, 0.95, 0.95], a: 0.6 });
  }

  /** Little bomblet blast: punchy, colourful, quick. */
  bomblet(x, y, z) {
    const R = Math.random;
    const c = [[1, 0.45, 0.85], [1, 0.85, 0.3], [0.6, 0.55, 1], [0.4, 1, 0.75]][Math.floor(R() * 4)];
    this.add({ k: 'fire', x, y: y + 0.4, z, vx: 0, vy: 3, vz: 0, drag: 2, life: 0.4, s0: 1.2, s1: 2.6, c0: [1, 1, 0.8], c1: c, a: 1 });
    for (let i = 0; i < 4; i++) { const a = R() * 6.28; this.add({ k: 'fire', x, y: y + 0.4, z, vx: Math.cos(a) * 5, vy: 2 + R() * 3, vz: Math.sin(a) * 5, drag: 4, life: 0.35 + R() * 0.2, s0: 0.7, s1: 1.4, c0: [1, 0.9, 0.5], c1: c, a: 1 }); }
    for (let i = 0; i < 8; i++) { const a = R() * 6.28, sp = 6 + R() * 8; this.add({ k: 'spark', x, y: y + 0.3, z, vx: Math.cos(a) * sp, vy: 5 + R() * 6, vz: Math.sin(a) * sp, grav: 20, life: 0.35, w: 0.08, len: 0.5, c0: [1, 1, 1], c1: c, a: 1 }); }
    this.add({ k: 'shock', x, y: this.world.heightAt(x, z) + 0.25, z, life: 0.3, s0: 0.5, s1: 5, c0: c, a: 0.8 });
    this.add({ k: 'puff', x, y: y + 0.5, z, vx: 0, vy: 1.5, vz: 0, life: 1.2, s0: 0.7, s1: 2.2, c0: [0.6, 0.6, 0.6], c1: [0.85, 0.85, 0.85], a: 0.55 });
    if (y - this.world.heightAt(x, z) < 2) this.scorch(x, z, 1.4);
  }

  /** High-velocity round strike: blinding blue-white spark fan and a hard shock ring. */
  hvImpact(x, y, z) {
    const R = Math.random;
    this.add({ k: 'glow', x, y, z, vx: 0, vy: 0, vz: 0, life: 0.12, s0: 2.5, s1: 5, c0: [0.8, 0.95, 1], c1: [0.4, 0.7, 1], a: 1 });
    for (let i = 0; i < 40; i++) {
      const a = R() * Math.PI * 2, sp = 14 + R() * 24;
      this.add({ k: 'spark', x, y, z, vx: Math.cos(a) * sp, vy: 3 + R() * 14, vz: Math.sin(a) * sp, grav: 24, life: 0.4 + R() * 0.4, w: 0.09, len: 1.2, c0: [1, 1, 1], c1: [0.4, 0.8, 1], a: 1 });
    }
    this.add({ k: 'shock', x, y, z, life: 0.3, s0: 1, s1: 11, c0: [0.7, 0.9, 1], a: 1 });
    this.popText(x, y + 3, z, ['THWACK!', 'CLANG!', 'KER-CHUNK!'][Math.floor(R() * 3)], 1.1, '#9fe7ff', true);
  }

  /** One drifting puff of a smoke screen. */
  smokePuff(x, y, z, r) {
    const R = Math.random;
    const g = 0.82 + R() * 0.12;
    this.add({ k: 'puff', x: x + (R() - 0.5) * r * 1.4, y: y + R() * 3, z: z + (R() - 0.5) * r * 1.4, vx: (R() - 0.5) * 0.8, vy: 0.4 + R() * 0.5, vz: (R() - 0.5) * 0.8, life: 3 + R() * 1.5, s0: 2.5, s1: 5 + R() * 2.5, c0: [g, g, g], c1: [g + 0.05, g + 0.05, g + 0.05], a: 0.85 });
  }

  /** Smaller puff for bullet hits. */
  impact(x, y, z, col = [1, 0.9, 0.5], n = 6) {
    const R = Math.random;
    for (let i = 0; i < n; i++) {
      const a = R() * Math.PI * 2, sp = 4 + R() * 8;
      this.add({ k: 'spark', x, y, z, vx: Math.cos(a) * sp, vy: 3 + R() * 7, vz: Math.sin(a) * sp, grav: 20, life: 0.25 + R() * 0.25, w: 0.06, len: 0.5, c0: col, c1: [1, 0.4, 0.1], a: 1 });
    }
    this.add({ k: 'puff', x, y, z, vx: 0, vy: 1.5, vz: 0, life: 0.6, s0: 0.3, s1: 1.1, c0: [0.75, 0.7, 0.6], c1: [0.8, 0.8, 0.8], a: 0.7 });
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
    // a licking tongue of fire: small hot core growing into an orange-red billow, plus the odd ember
    this.add({ k: 'fire', x, y, z, vx: vx * (0.9 + R() * 0.2), vy, vz: vz * (0.9 + R() * 0.2), drag: 1.4, rise: 3, life: 0.45 + R() * 0.2, s0: 0.25, s1: 1.4 + R() * 0.9, c0: [1, 0.9, 0.45], c1: [0.85, 0.18, 0.03], a: 1 });
    if (R() < 0.25) this.add({ k: 'spark', x, y, z, vx: vx * 0.8 + (R() - 0.5) * 4, vy: vy + 2 + R() * 3, vz: vz * 0.8 + (R() - 0.5) * 4, grav: 4, life: 0.6 + R() * 0.4, w: 0.06, len: 0.3, c0: [1, 0.8, 0.3], c1: [1, 0.3, 0.05], a: 1 });
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
      if (p.k === 'chunk') {
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
        const a = p.a * (p.k === 'puff' ? 1 - t * t : p.k === 'fire' ? 1 : 1 - t * t);
        // fire stays solid and shrinks away at the end instead of going see-through
        const sc = p.k === 'fire' && t > 0.6 ? s * Math.max(0, 1 - (t - 0.6) / 0.4) : s;
        m4.compose(m, p.x, p.y, p.z, p.age * 2, p.age, 0, sc);
        (p.k === 'glow' ? M.glow : p.k === 'fire' ? M.fire : M.puff).add(m, r, g, b, a);
      } else if (p.k === 'spark') {
        const sp = Math.hypot(p.vx, p.vy, p.vz) || 1;
        const yaw = Math.atan2(p.vx, p.vz), pitch = -Math.asin(clamp(p.vy / sp, -1, 1));
        const len = p.len * clamp(sp / 12, 0.3, 2);
        m4.compose(m, p.x, p.y, p.z, yaw, pitch, 0, p.w, p.w, len);
        M.spark.add(m, lerp(p.c0[0], p.c1[0], t), lerp(p.c0[1], p.c1[1], t), lerp(p.c0[2], p.c1[2], t), 1 - t);
      } else if (p.k === 'chunk') {
        const s = p.s0 * (t > 0.8 ? (1 - t) * 5 : 1);
        m4.compose(m, p.x, p.y, p.z, p.ry, p.rx, 0, s);
        M.chunk.add(m, p.c0[0], p.c0[1], p.c0[2], 1);
      } else if (p.k === 'shock') {
        const s = lerp(p.s0, p.s1, Math.sqrt(t));
        m4.compose(m, p.x, p.y, p.z, 0, 0, 0, s, 1, s);
        M.shock.add(m, p.c0[0], p.c0[1], p.c0[2], p.a * (1 - t));
      }
    }
    for (const d of this.decals) {
      const a = 0.55 * (1 - clamp((d.age - d.life + 6) / 6, 0, 1));
      alignToNormal(m, d.x, d.y, d.z, d.n, d.yaw, d.r, 1, d.r);
      M.decal.add(m, 0.12, 0.1, 0.08, a);
    }
    for (const t of this.tracks) {
      const a = 0.22 * (1 - t.age / 9);
      alignToNormal(m, t.x, t.y, t.z, t.n, t.yaw, t.w, 1, 0.42);
      M.track.add(m, 0.25, 0.2, 0.12, a);
    }
  }
}
