// Procedural battlefield: a floating tiled island diorama with cliffs, ponds, paths, forests, farm,
// decorations, seasons, contact shadows, collision + nav grids.
import { Geo, T } from './geo.js';
import { Mesh, hex } from './gl.js';
import { m4, makeNoise, makeRng, clamp, lerp, smooth, alignToNormal } from './math.js';

export const WATER_LEVEL = -1.2;
const GHOST_ALPHA = 0.2, GHOST_FADE_T = 0.25; // see-through props: final opacity and fade time (s)
/** Fallen logs are a ramp for every vehicle except the light scout, which treats them as solid. */
export const crossesLogs = (def) => def.id !== 'scout';

const DIRT = hex('#B88754'), STRAW = hex('#C7A866'), GRASS = hex('#75D152'), GRASS2 = hex('#61BD40');
const CLIFF = ['#9E6B45', '#785238', '#664733', '#4F3727'].map(hex);
const EDGE_H = 0.4;
// colours that change with the season (ground tweaks, foliage multipliers, water, falling things)
const SEASONS = {
  spring: { grass: hex('#86DB5A'), grass2: hex('#6CC94A'), foliage: [[1.05, 1.06, 0.98], [1.0, 1.04, 0.92], [1.08, 1.05, 1.0]], water: hex('#5AAEF4'), fall: [[1, 0.72, 0.84], [1, 0.84, 0.92], [1, 1, 1]], fallN: 140 },
  summer: { grass: GRASS, grass2: GRASS2, foliage: [[1, 1, 1], [0.94, 0.97, 0.94], [1.05, 1.02, 1]], water: hex('#54A8F2'), fall: null, fallN: 0 },
  autumn: { grass: hex('#A6C850'), grass2: hex('#94B445'), foliage: [[1.88, 0.63, 0.47], [1.75, 0.37, 0.41], [1.9, 0.94, 0.57], [1.6, 0.8, 0.45]], water: hex('#4F9FE6'), fall: [[0.96, 0.55, 0.2], [0.88, 0.3, 0.16], [0.98, 0.78, 0.25]], fallN: 120 },
  winter: { grass: hex('#E4EEF2'), grass2: hex('#D2E4E8'), foliage: [[0.82, 0.88, 0.92], [0.78, 0.86, 0.9]], water: hex('#BCE4F6'), fall: [[1, 1, 1]], fallN: 160 },
};

export class World {
  /** renderer may be null (headless server): no meshes or cosmetic decoration are built. */
  constructor(renderer, models, cfg) {
    this.r = renderer;
    this.headless = !renderer;
    this.M = models;
    this.cfg = cfg;
    this.size = cfg.mapSize;
    this.half = this.size / 2;
    this.rng = makeRng(cfg.seed * 7919 + 13);
    this.rngC = makeRng(cfg.seed * 104729 + 7); // cosmetic-only randomness
    this.noise = makeNoise(cfg.seed);
    this.obstacles = [];
    this.logs = [];
    this.cellSize = 8;
    this.gridN = Math.ceil(this.size / this.cellSize);
    this.grid = Array.from({ length: this.gridN * this.gridN }, () => []);
    this.ponds = [];
    this.paths = [];
    this.spawns = [];
    this.pickupSpots = [];
    this.ambient = { birds: [], flies: [], ducks: [], clouds: [], blades: [], fall: [] };
    this.season = SEASONS[cfg.season] ? cfg.season : 'summer';
    this.S = SEASONS[this.season];
    this.tmpM = m4.create();
    this.layout();
    this.buildHeights();
    if (!this.headless) { this.buildTerrainMesh(); this.buildCliffs(); this.buildWater(); }
    this.decorate();
    this.buildNav();
    this.pickupSpots = this.pickupSpots.filter((p) => this.reachable(p.x, p.z));
  }

  // ---------- layout & heights ----------
  layout() {
    const rng = this.rng, H = this.half;
    const sp = H * 0.6;
    this.spawns = [[-sp, -sp], [sp, sp], [sp, -sp], [-sp, sp]].map(([x, z]) => ({ x, z }));
    // ponds: keep them away from spawns
    const nP = 2 + Math.floor(rng() * 2);
    let tries = 0;
    while (this.ponds.length < nP && tries++ < 200) {
      const p = { x: rng.range(-H * 0.6, H * 0.6), z: rng.range(-H * 0.6, H * 0.6), r: rng.range(14, 24) };
      if (this.spawns.some((s) => Math.hypot(s.x - p.x, s.z - p.z) < p.r + 40)) continue;
      if (this.ponds.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < q.r + p.r + 30)) continue;
      if (Math.hypot(p.x, p.z) < p.r + 22) continue; // keep centre free for the farm
      this.ponds.push(p);
    }
    // winding dirt paths: spawn -> centre
    for (const s of this.spawns) {
      const pts = [];
      const n = 7;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const wob = Math.sin(t * Math.PI) * 18;
        const nx = -s.z, nz = s.x, nl = Math.hypot(nx, nz) || 1;
        pts.push([lerp(s.x, 0, t) + (nx / nl) * wob * Math.sin(t * 5 + s.x), lerp(s.z, 0, t) + (nz / nl) * wob * Math.sin(t * 5 + s.x)]);
      }
      this.paths.push(pts);
    }
    // loop road around the farm
    const loop = [];
    for (let i = 0; i <= 16; i++) { const a = (i / 16) * Math.PI * 2; loop.push([Math.cos(a) * 26, Math.sin(a) * 26]); }
    this.paths.push(loop);
  }

  pathDist(x, z) {
    let best = 1e9;
    for (const p of this.paths) {
      for (let i = 0; i < p.length - 1; i++) {
        const [ax, az] = p[i], [bx, bz] = p[i + 1];
        const dx = bx - ax, dz = bz - az;
        const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
        const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
        if (d < best) best = d;
      }
    }
    return best;
  }

  rawHeight(x, z) {
    const n = this.noise, H = this.half;
    let h = (n.fbm(x * 0.011 + 50, z * 0.011 + 50, 4) - 0.5) * 16 + Math.sin(x * 0.031) * Math.cos(z * 0.027) * 2.2;
    // natural hollows stay dry — only the hand-placed ponds hold water, so the map stays connected
    const floor = WATER_LEVEL + 0.9;
    if (h < floor) h = floor - (floor - h) * 0.08;
    const e = Math.max(Math.abs(x), Math.abs(z)) / H;
    // gently flatten spawns and farm
    for (const s of this.spawns) {
      const d = Math.hypot(x - s.x, z - s.z);
      if (d < 26) h = lerp(h, 0.6, 1 - smooth(d / 26));
    }
    const dc = Math.hypot(x, z);
    if (dc < 34) h = lerp(h, 0.8, 1 - smooth(dc / 34));
    for (const p of this.ponds) {
      const d = Math.hypot(x - p.x, z - p.z);
      const R = p.r * 1.5;
      if (d < R) {
        const k = 1 - smooth(d / R);
        h = lerp(h, -4.5, k * 1.15 > 1 ? 1 : k * 1.15);
      }
    }
    // the island rim settles to a level shelf so the cliff slabs meet it cleanly
    if (e > 0.88) h = lerp(h, EDGE_H, smooth(clamp((e - 0.88) / 0.1, 0, 1)));
    return h;
  }

  buildHeights() {
    // the island ends at the map edge and floats in the sky
    const C = (this.hc = 2.5);
    this.ext = Math.ceil(this.half / C) * C;
    const N = (this.hn = Math.round((2 * this.ext) / C) + 1);
    this.hgt = new Float32Array(N * N);
    this.pathD = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = -this.ext + i * C, z = -this.ext + j * C;
      const inside = Math.abs(x) < this.half && Math.abs(z) < this.half;
      const pd = inside ? this.pathDist(x, z) : 99;
      let h = this.rawHeight(x, z);
      // paths are slightly sunken dirt tracks, and become little causeways where they cross a pond
      if (pd < 6) h = lerp(h, Math.max(h * 0.6 - 0.15, WATER_LEVEL + 0.75), 1 - smooth(pd / 6));
      this.hgt[j * N + i] = h;
      this.pathD[j * N + i] = pd;
    }
  }

  /** Height matching the rendered triangles exactly. */
  heightAt(x, z) {
    const C = this.hc, N = this.hn;
    let fx = (x + this.ext) / C, fz = (z + this.ext) / C;
    fx = clamp(fx, 0, N - 1.001); fz = clamp(fz, 0, N - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz);
    const u = fx - i, v = fz - j;
    const h00 = this.hgt[j * N + i], h10 = this.hgt[j * N + i + 1], h01 = this.hgt[(j + 1) * N + i], h11 = this.hgt[(j + 1) * N + i + 1];
    // triangles: (00,01,11) and (00,11,10) split along the diagonal u==v
    if (v > u) return h00 + (h11 - h01) * u + (h01 - h00) * v;
    return h00 + (h10 - h00) * u + (h11 - h10) * v;
  }

  /** Ground height for a vehicle: the terrain, plus fallen logs when it can drive over them. */
  groundAt(x, z, logs) {
    const h = this.heightAt(x, z);
    if (!logs) return h;
    let g = h;
    for (const L of this.logs) {
      const dx = x - L.x, dz = z - L.z;
      if (Math.abs(dx) > L.hl + L.w || Math.abs(dz) > L.hl + L.w) continue;
      const a = Math.abs(dx * L.ax + dz * L.az), p = Math.abs(dz * L.ax - dx * L.az);
      if (p >= L.w || a >= L.hl + 0.3) continue;
      const end = Math.min(1, (L.hl + 0.3 - a) / 0.6); // taper off past the cut ends
      g = Math.max(g, L.base + L.top * 0.5 * (1 + Math.cos(Math.PI * p / L.w)) * end);
    }
    return g;
  }

  normalAt(x, z, out = [0, 1, 0]) {
    const e = 1.2;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    let nx = -hx, ny = 2 * e, nz = -hz;
    const l = Math.hypot(nx, ny, nz);
    out[0] = nx / l; out[1] = ny / l; out[2] = nz / l;
    return out;
  }

  isWater(x, z) { return this.heightAt(x, z) < WATER_LEVEL + 0.15; }
  inBounds(x, z, m = 0) { return Math.abs(x) < this.half * 0.86 - m && Math.abs(z) < this.half * 0.86 - m; }

  /** 0 = bare dirt, 0.5 = dry straw, 1 = lush grass. Drives both tile colour and grass tufts. */
  growthAt(x, z, h, pd, slope) {
    const n = this.noise;
    const meadow = n.fbm(x * 0.02 + 70, z * 0.02 - 20, 3);
    let g = 0.72 + meadow * 0.35 + (n(x * 0.05 + 9, z * 0.05 + 3) - 0.5) * 0.25;
    if (pd < 5) g = Math.min(g, lerp(0.02, 1, smooth(clamp((pd - 2.2) / 2.8, 0, 1))));
    if (h < WATER_LEVEL + 1.1) g = Math.min(g, lerp(0.35, 1, clamp((h - WATER_LEVEL - 0.3) / 0.8, 0, 1)));
    if (slope > 0.6) g -= clamp((slope - 0.6) * 0.8, 0, 0.4);
    return clamp(g, 0, 1);
  }

  groundColor(x, z, h, g) {
    const S = this.S;
    if (h < WATER_LEVEL - 0.4) return [0.42, 0.52, 0.5];
    const lush = smooth(clamp((this.forestDensity(x, z) - 0.45) * 4, 0, 1));
    const grass = [lerp(S.grass[0], S.grass2[0], lush), lerp(S.grass[1], S.grass2[1], lush), lerp(S.grass[2], S.grass2[2], lush)];
    if (g < 0.5) { const k = g / 0.5; return [lerp(DIRT[0], STRAW[0], k), lerp(DIRT[1], STRAW[1], k), lerp(DIRT[2], STRAW[2], k)]; }
    const k = smooth(clamp((g - 0.5) / 0.3, 0, 1));
    return [lerp(STRAW[0], grass[0], k), lerp(STRAW[1], grass[1], k), lerp(STRAW[2], grass[2], k)];
  }

  forestDensity(x, z) { return this.noise.fbm(x * 0.009 + 200, z * 0.009 - 100, 3); }

  slopeAt(i, j) {
    const C = this.hc, N = this.hn;
    const H = (a, b) => this.hgt[clamp(b, 0, N - 1) * N + clamp(a, 0, N - 1)];
    return Math.max(Math.abs(H(i + 1, j) - H(i - 1, j)), Math.abs(H(i, j + 1) - H(i, j - 1))) / (2 * C);
  }

  /**
   * The ground is a grid of slightly separated tiles, each one flat-coloured with a ±3% checkerboard
   * nudge, sitting on a darker soil underlay that shows through the seams.
   */
  buildTerrainMesh() {
    const C = this.hc, N = this.hn, E = this.ext;
    const cells = (N - 1) * (N - 1);
    const pos = new Float32Array(cells * 12 * 3), nor = new Float32Array(cells * 12 * 3), col = new Float32Array(cells * 12 * 4);
    let v = 0;
    const put = (x, y, z, n, c) => {
      pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
      nor[v * 3] = n[0]; nor[v * 3 + 1] = n[1]; nor[v * 3 + 2] = n[2];
      col[v * 4] = c[0]; col[v * 4 + 1] = c[1]; col[v * 4 + 2] = c[2]; col[v * 4 + 3] = 0;
      v++;
    };
    const gap = 0.05;
    this.growth = new Float32Array(cells);
    for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
      const x0 = -E + i * C, z0 = -E + j * C, x1 = x0 + C, z1 = z0 + C;
      const cx = x0 + C / 2, cz = z0 + C / 2;
      const h00 = this.hgt[j * N + i], h10 = this.hgt[j * N + i + 1], h01 = this.hgt[(j + 1) * N + i], h11 = this.hgt[(j + 1) * N + i + 1];
      const hc = (h00 + h10 + h01 + h11) / 4;
      const pd = Math.min(this.pathD[j * N + i], this.pathD[j * N + i + 1], this.pathD[(j + 1) * N + i], this.pathD[(j + 1) * N + i + 1]);
      const g = this.growthAt(cx, cz, hc, pd, this.slopeAt(i, j));
      this.growth[j * (N - 1) + i] = g;
      const base = this.groundColor(cx, cz, hc, g);
      const k = ((i + j) & 1 ? 1.03 : 0.97) * (0.985 + this.rngC() * 0.03);
      const c = [base[0] * k, base[1] * k, base[2] * k];
      // one normal per tile so the cel bands never split a tile along its diagonal
      let nx = (h00 + h01 - h10 - h11) / (2 * C), nz = (h00 + h10 - h01 - h11) / (2 * C);
      const nl = Math.hypot(nx, 1, nz); const n = [nx / nl, 1 / nl, nz / nl];
      // seam underlay (full cell, lowered, darker)
      const dk = [base[0] * 0.74, base[1] * 0.72, base[2] * 0.7], d = 0.14;
      put(x0, h00 - d, z0, n, dk); put(x0, h01 - d, z1, n, dk); put(x1, h11 - d, z1, n, dk);
      put(x0, h00 - d, z0, n, dk); put(x1, h11 - d, z1, n, dk); put(x1, h10 - d, z0, n, dk);
      // the tile itself, inset by the seam
      const ax = x0 + gap, az = z0 + gap, bx = x1 - gap, bz = z1 - gap;
      const ya = this.heightAt(ax, az), yb = this.heightAt(bx, az), yc = this.heightAt(ax, bz), yd = this.heightAt(bx, bz);
      put(ax, ya, az, n, c); put(ax, yc, bz, n, c); put(bx, yd, bz, n, c);
      put(ax, ya, az, n, c); put(bx, yd, bz, n, c); put(bx, yb, az, n, c);
    }
    this.terrain = new Mesh(this.r, { pos, nor, col }, { static: true, outline: false });
    this.terrain.add(m4.create());
  }

  tileGrowth(x, z) {
    const N = this.hn - 1;
    const i = clamp(Math.floor((x + this.ext) / this.hc), 0, N - 1), j = clamp(Math.floor((z + this.ext) / this.hc), 0, N - 1);
    return this.growth[j * N + i];
  }

  /** The island edge steps down in layered slabs, each narrower and darker. */
  buildCliffs() {
    const g = new Geo();
    const E = this.ext;
    let top = EDGE_H + 0.02;
    const steps = [[0, 3.2], [2.2, 3.4], [5.0, 3.6], [8.4, 3.2]];
    steps.forEach(([inset, h], k) => {
      const R = E - inset, b = top - h, c = [...CLIFF[k], 0];
      const p = (x, y, z) => [x, y, z];
      g.quad(p(-R, b, R), p(R, b, R), p(R, top, R), p(-R, top, R), c);
      g.quad(p(R, b, -R), p(-R, b, -R), p(-R, top, -R), p(R, top, -R), c);
      g.quad(p(R, b, R), p(R, b, -R), p(R, top, -R), p(R, top, R), c);
      g.quad(p(-R, b, -R), p(-R, b, R), p(-R, top, R), p(-R, top, -R), c);
      // underside of the slab above, between it and this narrower one
      if (k > 0) {
        const r0 = E - steps[k - 1][0];
        const lip = [CLIFF[k - 1][0] * 0.7, CLIFF[k - 1][1] * 0.7, CLIFF[k - 1][2] * 0.7, 0];
        // (faces down: it is the underside of the wider slab above)
        g.quad(p(-R, top, R), p(R, top, R), p(r0, top, r0), p(-r0, top, r0), lip);
        g.quad(p(R, top, -R), p(-R, top, -R), p(-r0, top, -r0), p(r0, top, -r0), lip);
        g.quad(p(R, top, R), p(R, top, -R), p(r0, top, -r0), p(r0, top, r0), lip);
        g.quad(p(-R, top, -R), p(-R, top, R), p(-r0, top, r0), p(-r0, top, -r0), lip);
      }
      if (k === steps.length - 1) g.quad(p(-R, b, -R), p(R, b, -R), p(R, b, R), p(-R, b, R), c);
      top = b;
    });
    this.cliffs = new Mesh(this.r, g, { static: true, outline: false });
    this.cliffs.add(m4.create());
  }

  buildWater() {
    const g = new Geo();
    const c = [1, 1, 1, 1];
    const C = this.hc, gap = 0.05, E = this.ext;
    for (const p of this.ponds) {
      const R = p.r * 1.5 + 2;
      const i0 = Math.floor((p.x - R + E) / C), i1 = Math.ceil((p.x + R + E) / C);
      const j0 = Math.floor((p.z - R + E) / C), j1 = Math.ceil((p.z + R + E) / C);
      for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
        const x0 = -E + i * C + gap, z0 = -E + j * C + gap, x1 = x0 + C - 2 * gap, z1 = z0 + C - 2 * gap;
        // only tiles that actually dip below the waterline
        if (Math.min(this.heightAt(x0, z0), this.heightAt(x1, z0), this.heightAt(x0, z1), this.heightAt(x1, z1)) > WATER_LEVEL) continue;
        const A = [x0, 0, z0], B = [x1, 0, z0], Cc = [x0, 0, z1], D = [x1, 0, z1];
        g.tri(A, Cc, D, c); g.tri(A, D, B, c);
      }
    }
    if (g.pos.length) {
      const w = this.S.water;
      this.water = new Mesh(this.r, g, { static: true, mode: 2, transparent: true, layer: 3 });
      this.water.add(m4.compose(m4.create(), 0, WATER_LEVEL, 0), w[0], w[1], w[2], this.season === 'winter' ? 0.96 : 0.9);
    }
  }

  /** Soft contact shadow, nudged away from the sun by the object's height. */
  blob(mesh, x, z, r, h = 1, a = 0.22) {
    if (this.headless) return;
    const off = Math.min(h * 0.1, r * 0.45);
    x -= 0.815 * off; z -= 0.58 * off;
    const n = this.normalAt(x, z, this._bn || (this._bn = [0, 1, 0]));
    alignToNormal(this.tmpM, x, this.heightAt(x, z) + 0.05, z, n, 0, r, 1, r);
    mesh.add(this.tmpM, 0.07, 0.17, 0.06, a); // translucent dark green
  }

  // ---------- obstacles ----------
  addObstacle(o) {
    o.alive = true;
    o.index = this.obstacles.length; // stable id shared by server and clients
    this.obstacles.push(o);
    this.gridInsert(o);
    return o;
  }

  gridInsert(o) {
    const cs = this.cellSize, N = this.gridN;
    const r = o.r + 0.1;
    const i0 = clamp(Math.floor((o.x - r + this.half) / cs), 0, N - 1), i1 = clamp(Math.floor((o.x + r + this.half) / cs), 0, N - 1);
    const j0 = clamp(Math.floor((o.z - r + this.half) / cs), 0, N - 1), j1 = clamp(Math.floor((o.z + r + this.half) / cs), 0, N - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.grid[j * N + i].push(o);
  }

  /** Visit obstacles near (x,z) within radius r. */
  query(x, z, r, cb) {
    const cs = this.cellSize, N = this.gridN;
    const i0 = clamp(Math.floor((x - r + this.half) / cs), 0, N - 1), i1 = clamp(Math.floor((x + r + this.half) / cs), 0, N - 1);
    const j0 = clamp(Math.floor((z - r + this.half) / cs), 0, N - 1), j1 = clamp(Math.floor((z + r + this.half) / cs), 0, N - 1);
    const stamp = (this._stamp = (this._stamp || 0) + 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      for (const o of this.grid[j * N + i]) {
        if (!o.alive || o._s === stamp) continue;
        o._s = stamp;
        const dx = o.x - x, dz = o.z - z, rr = o.r + r;
        if (dx * dx + dz * dz < rr * rr) if (cb(o) === false) return;
      }
    }
  }

  /** Is there a solid obstacle on the segment (for line-of-sight)? `y` heights considered. */
  segmentBlocked(x0, y0, z0, x1, y1, z1, ignoreSoft = true) {
    const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz);
    const steps = Math.ceil(L / 3);
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const x = x0 + dx * t, z = z0 + dz * t, y = y0 + (y1 - y0) * t;
      if (this.heightAt(x, z) > y + 0.3) return true;
      let hit = false;
      this.query(x, z, 0.5, (o) => {
        if (ignoreSoft && o.soft) return;
        if (y < o.top) { hit = true; return false; }
      });
      if (hit) return true;
    }
    return false;
  }

  canPlace(x, z, r, opts = {}) {
    if (!this.inBounds(x, z, opts.margin ?? 4)) return false;
    const h = this.heightAt(x, z);
    if (h < WATER_LEVEL + 0.7) return false;
    if (opts.noPath !== false && this.pathDist(x, z) < (opts.pathClear ?? 5)) return false;
    if (this.spawns.some((s) => Math.hypot(s.x - x, s.z - z) < (opts.spawnClear ?? 16))) return false;
    if (Math.hypot(x, z) < (opts.centreClear ?? 0)) return false;
    let ok = true;
    this.query(x, z, r + (opts.gap ?? 1), () => { ok = false; return false; });
    return ok;
  }

  // ---------- decoration ----------
  decorate() {
    // obstacles use `rng` so the server (headless) and every client build the same ones;
    // anything purely cosmetic uses `rngC` so graphics settings and seasons never shift them
    const rng = this.rng, rngC = this.rngC, M = this.M, H = this.half, m = this.tmpM, S = this.S;
    const dens = this.cfg.trees;
    const B = M.blobStatic;
    const place = (n, r, opts, fn) => {
      let placed = 0, tries = 0;
      while (placed < n && tries++ < n * 30) {
        const x = rng.range(-H, H), z = rng.range(-H, H);
        if (opts.accept && !opts.accept(x, z)) continue;
        if (!this.canPlace(x, z, r, opts)) continue;
        fn(x, z, this.heightAt(x, z));
        placed++;
      }
    };
    const foliage = () => {
      const f = S.foliage[Math.floor(rngC() * S.foliage.length)];
      const j = 0.94 + rngC() * 0.1;
      return [f[0] * j, f[1] * j, f[2] * j];
    };

    // houses, the windmill and big boulders are drawn per frame so they can fade when hiding a tank
    this.bigProps = [];
    // --- farm in the centre ---
    const house = (x, z, yaw) => {
      const y = this.heightAt(x, z) - 0.2;
      this.bigProps.push({ mesh: M.house, ghost: M.houseG, m: m4.compose(m4.create(), x, y, z, yaw), col: [0.95, 0.36, 0.32], x, z, base: y, top: y + 7, rad: 4.4 });
      this.blob(B, x, z, 5.6, 6);
      // approximate the house with a few circles
      const c = Math.cos(yaw), s = Math.sin(yaw);
      for (const ox of [-2.4, 0, 2.4]) this.addObstacle({ x: x + c * ox, z: z - s * ox, r: 2.8, top: y + 6, kind: 'house' });
    };
    house(-12, 8, 0.3);
    const wmX = 11, wmZ = -9;
    const wy = this.heightAt(wmX, wmZ) - 0.2;
    this.bigProps.push({ mesh: M.windmill, ghost: M.windmillG, m: m4.compose(m4.create(), wmX, wy, wmZ, -0.6), col: [1, 1, 1], x: wmX, z: wmZ, base: wy, top: wy + 14, rad: 2.8 });
    this.blob(B, wmX, wmZ, 4.2, 10);
    this.addObstacle({ x: wmX, z: wmZ, r: 3.2, top: wy + 14, kind: 'windmill' });
    this.ambient.blades.push({ x: wmX + Math.sin(-0.6) * 2.4, y: wy + 10.5, z: wmZ + Math.cos(-0.6) * 2.4, yaw: -0.6, a: 0 });
    for (let i = 0; i < 6; i++) {
      const x = -2 + i * 2.2, z = 16 + (i % 2) * 2.2;
      M.hay.add(m4.compose(m, x, this.heightAt(x, z) - 0.1, z, 0.2 * i));
      this.blob(B, x - 0.9, z, 1.5, 1.8);
      this.addObstacle({ x, z, r: 1.2, top: this.heightAt(x, z) + 1.8, kind: 'hay' });
    }
    // fences along the farm loop road
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + 0.17;
      if (i % 4 === 0) continue;
      const R = 33, x = Math.cos(a) * R, z = Math.sin(a) * R;
      M.fence.add(m4.compose(m, x, this.heightAt(x, z), z, -a));
      this.addObstacle({ x, z, r: 1.1, top: this.heightAt(x, z) + 1.2, kind: 'fence', soft: true });
    }

    // --- wooden posts along the island rim ---
    const E = this.ext - 1.4;
    for (let side = 0; side < 4; side++) {
      for (let t = -E + 4; t < E - 4; t += 6.5) {
        if (this.noise(t * 0.04 + side * 17, side * 3.1) < 0.52) continue; // a few short runs, not a wall
        const x = side === 0 ? t : side === 1 ? t : side === 2 ? E : -E;
        const z = side === 0 ? E : side === 1 ? -E : t;
        const h = this.heightAt(x, z);
        M.post.add(m4.compose(m, x, h - 0.1, z, rngC() * 0.3, (rngC() - 0.5) * 0.12, (rngC() - 0.5) * 0.12, rngC.range(0.9, 1.15)));
        this.blob(B, x, z, 0.45, 1.2);
      }
    }

    // --- rocks: little clusters of lumpy boulders ---
    place(Math.round(55 * dens), 2.5, { gap: 2 }, (x, z, h) => {
      const s = rng.range(1.2, 3.4);
      const g = rng.range(0.92, 1.05);
      const rm = m4.compose(m4.create(), x, h - 0.2, z, rng() * 6.28, rng() * 0.2, 0, s, s * rng.range(0.7, 1.2), s);
      this.bigProps.push({ mesh: M.boulder, ghost: M.boulderG, m: rm, col: [g, g, g], x, z, base: h - 0.2, top: h - 0.2 + rm[5] * 1.3, rad: s * 1.05 });
      this.blob(B, x, z, s * 1.25, s);
      this.addObstacle({ x, z, r: s * 0.95, top: h + s * 0.9, kind: 'rock' });
      const n = rngC.int(1, 3);
      for (let i = 0; i < n; i++) {
        const a = rngC() * 6.28, d = s * rngC.range(1.0, 1.4), ss = s * rngC.range(0.25, 0.45);
        const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d, ph = this.heightAt(px, pz);
        if (ph < WATER_LEVEL + 0.5) continue;
        M.rock.add(m4.compose(m, px, ph - 0.1, pz, rngC() * 6.28, 0, 0, ss), g, g, g);
        this.blob(B, px, pz, ss * 1.3, ss);
      }
    });

    // --- trees: dense forests + scattered singles ---
    this.trees = [];
    const addTree = (x, z, h, kind, s, solid) => {
      const yaw = (solid ? rng : rngC)() * 6.28;
      const col = kind === 1 ? (this.season === 'winter' ? [0.9, 0.95, 0.95] : [1, 1, 1]) : foliage();
      const top = h + (kind === 1 ? 5.7 : 6.5) * s;
      // contact shadows for trees and giant mushrooms are drawn per frame so they fade with a ghosted prop
      this.trees.push({ kind, x, z, s, top, col, br: (kind === 1 ? 2.2 : 2.6) * s, m: m4.compose(m4.create(), x, h - 0.1, z, yaw, 0, 0, s) });
      if (solid) this.addObstacle({ x, z, r: 0.7 * s, top, kind: 'tree', cr: 2.4 * s, cb: h + 2.4 * s });
    };
    place(Math.round(340 * dens), 1.4, {
      gap: 2.2,
      accept: (x, z) => { const f = this.forestDensity(x, z); return rng() < (f > 0.55 ? 0.95 : 0.1); },
    }, (x, z, h) => {
      const kind = rng() < 0.42 ? 1 : rng() < 0.7 ? 0 : 2;
      addTree(x, z, h, kind, rng.range(0.9, 1.5), true);
    });
    // a ring of trees on the unreachable rim (no collision needed)
    for (let i = 0; i < 140 * dens; i++) {
      const side = Math.floor(rngC() * 4), t = rngC.range(-H * 0.95, H * 0.95), d = rngC.range(H * 0.88, H * 0.96);
      const x = side === 0 ? t : side === 1 ? t : side === 2 ? d : -d;
      const z = side === 0 ? d : side === 1 ? -d : t;
      if (this.heightAt(x, z) < WATER_LEVEL + 0.7) continue;
      addTree(x, z, this.heightAt(x, z), rngC() < 0.5 ? 1 : rngC() < 0.7 ? 0 : 2, rngC.range(1.0, 1.6), false);
    }

    // --- giant mushrooms (whimsy!) ---
    this.mushrooms = [];
    place(Math.round(22 * dens), 2, { gap: 3 }, (x, z, h) => {
      const s = rng.range(0.8, 1.6);
      const c = rng() < 0.8 ? [0.95, 0.16, 0.14] : [0.65, 0.35, 1];
      this.mushrooms.push({ x, z, s, top: h + 3.5 * s, col: c, br: 2.1 * s, m: m4.compose(m4.create(), x, h - 0.1, z, rng() * 6.28, (rng() - 0.5) * 0.15, (rng() - 0.5) * 0.15, s) });
      this.addObstacle({ x, z, r: 0.7 * s, top: h + 3.5 * s, kind: 'mushroom', cr: 2 * s, cb: h + 2 * s });
    });

    // --- fallen logs in and around the woods ---
    place(Math.round(16 * dens), 1.6, { gap: 1.5, accept: (x, z) => this.forestDensity(x, z) > 0.45 }, (x, z, h) => {
      const yaw = rng() * 6.28, s = rng.range(0.85, 1.2);
      M.log.add(m4.compose(m, x, h - 0.12, z, yaw, 0, 0, s));
      this.blob(B, x, z, 1.7 * s, 0.6);
      const c = Math.cos(yaw), sn = Math.sin(yaw);
      for (const o of [-0.9, 0.9]) this.addObstacle({ x: x + c * o * s, z: z - sn * o * s, r: 0.7 * s, top: h + 0.8 * s, kind: 'rock', log: true });
      // drive-over profile: a smooth hump a little wider than the trunk so tracks ramp up onto it
      this.logs.push({ x, z, ax: c, az: -sn, hl: 1.4 * s, w: 1.2 * s, base: h - 0.12, top: 0.76 * s });
    });

    // --- destructibles ---
    this.bushes = [];
    place(Math.round(160 * dens), 1.3, { gap: 0.8, pathClear: 3.5 }, (x, z, h) => {
      const s = rng.range(0.9, 1.6);
      const g = rng.range(0.9, 1.08);
      const base = this.season === 'autumn' ? [0.62, 0.62, 0.26] : this.season === 'winter' ? [0.4, 0.58, 0.42] : [0.42, 0.78, 0.32];
      this.addObstacle({ x, z, r: 0.9 * s, top: h + 1.3 * s, kind: 'bush', soft: true, hp: 1, s, yaw: rng() * 6.28, col: [base[0] * g, base[1] * g, base[2] * g], y: h - 0.1, squash: 0, berries: rngC() < 0.35 });
      this.bushes.push(this.obstacles[this.obstacles.length - 1]);
    });
    this.crates = [];
    place(Math.round(36 * dens), 1.3, { gap: 1.5, spawnClear: 20 }, (x, z, h) => {
      const n = rng() < 0.4 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const ox = i * 1.7, yaw = rng() * 0.4;
        const o = this.addObstacle({ x: x + ox, z, r: 1.1, top: h + 1.6, kind: 'crate', hp: 30, yaw, y: this.heightAt(x + ox, z) - 0.05 });
        this.crates.push(o);
      }
    });
    this.barrels = [];
    place(Math.round(26 * dens), 1, { gap: 1.5, spawnClear: 24 }, (x, z, h) => {
      const n = rng.int(1, 3);
      for (let i = 0; i < n; i++) {
        const a = i * 2.1, bx = x + Math.cos(a) * (i ? 1.4 : 0), bz = z + Math.sin(a) * (i ? 1.4 : 0);
        const o = this.addObstacle({ x: bx, z: bz, r: 0.75, top: h + 1.6, kind: 'barrel', hp: 15, yaw: rng() * 6.28, y: this.heightAt(bx, bz) - 0.05, explosive: true });
        this.barrels.push(o);
      }
    });

    // --- pickup spots ---
    let ptries = 0;
    const want = Math.round(clamp(this.size / 18, 12, 30));
    while (this.pickupSpots.length < want && ptries++ < 4000) {
      const x = rng.range(-H * 0.8, H * 0.8), z = rng.range(-H * 0.8, H * 0.8);
      if (!this.canPlace(x, z, 2.5, { gap: 2, noPath: false, spawnClear: 18 })) continue;
      if (this.pickupSpots.some((p) => Math.hypot(p.x - x, p.z - z) < 30)) continue;
      this.pickupSpots.push({ x, z });
    }

    // everything below is purely cosmetic: the server (headless) skips it
    if (this.headless) return;
    // --- small non-colliding details: flowers, toadstools, grass tufts, lily pads, reeds ---
    const petal = [[1, 0.45, 0.65], [1, 0.86, 0.25], [0.74, 0.58, 1], [1, 1, 1], [1, 0.6, 0.22], [0.45, 0.75, 1]];
    const gq = this.cfg.quality === 'low' ? 0.4 : this.cfg.quality === 'high' ? 1.4 : 1;
    this.flowers = [];
    let nf = 0, tries = 0;
    const flowerN = this.season === 'winter' ? 0 : this.season === 'autumn' ? 500 : this.season === 'spring' ? 1800 : 1400;
    while (nf < flowerN * gq && tries++ < 20000) {
      // flowers come in little clumps
      const cx = rngC.range(-H * 0.85, H * 0.85), cz = rngC.range(-H * 0.85, H * 0.85);
      const meadow = this.noise.fbm(cx * 0.02 + 70, cz * 0.02 - 20, 3);
      if (meadow < 0.5 && rngC() > 0.25) continue;
      const col = petal[Math.floor(rngC() * petal.length)];
      for (let k = 0; k < 8; k++) {
        const x = cx + rngC.range(-3, 3), z = cz + rngC.range(-3, 3);
        const h = this.heightAt(x, z);
        if (h < WATER_LEVEL + 0.8 || this.pathDist(x, z) < 3) continue;
        const s = rngC.range(0.9, 1.6);
        M.flower.add(m4.compose(m, x, h - 0.05, z, rngC() * 6.28, 0, 0, s), col[0], col[1], col[2]);
        if (k === 0) this.flowers.push({ x, z, y: h + 0.75 * s });
        nf++;
      }
    }
    for (let i = 0; i < 160 * dens * gq; i++) {
      const x = rngC.range(-H * 0.85, H * 0.85), z = rngC.range(-H * 0.85, H * 0.85);
      if (this.forestDensity(x, z) < 0.5 && rngC() > 0.2) continue;
      const h = this.heightAt(x, z);
      if (h < WATER_LEVEL + 0.8 || this.pathDist(x, z) < 3) continue;
      const s = rngC.range(0.8, 1.6);
      M.toadstool.add(m4.compose(m, x, h - 0.05, z, rngC() * 6.28, (rngC() - 0.5) * 0.3, (rngC() - 0.5) * 0.3, s));
    }
    const tuftCol = this.season === 'winter' ? [0.86, 0.93, 0.96] : null;
    for (let i = 0; i < 9000 * gq; i++) {
      const x = rngC.range(-H * 0.95, H * 0.95), z = rngC.range(-H * 0.95, H * 0.95);
      const h = this.heightAt(x, z);
      if (h < WATER_LEVEL + 0.5) continue;
      // tufts grow taller and denser with the ground's growth
      const g = this.tileGrowth(x, z);
      if (g < 0.35 || rngC() > g * g) continue;
      const s = rngC.range(0.75, 1.15) * (0.55 + g * 0.75);
      const c = tuftCol || this.groundColor(x, z, h, Math.min(1, g + 0.1));
      const j = 1.05 + rngC() * 0.12;
      M.grass.add(m4.compose(m, x, h - 0.05, z, rngC() * 6.28, 0, 0, s, s * rngC.range(0.85, 1.35), s), c[0] * j, c[1] * j, c[2] * j);
    }
    for (const p of this.ponds) {
      for (let i = 0; i < 12; i++) {
        const a = rngC() * 6.28, d = rngC.range(2, p.r * 1.25);
        const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
        if (this.heightAt(x, z) > WATER_LEVEL - 0.3 || this.season === 'winter') continue;
        M.lily.add(m4.compose(m, x, WATER_LEVEL + 0.04, z, rngC() * 6.28, 0, 0, rngC.range(0.6, 1.3)));
      }
      if (this.season !== 'winter') for (let i = 0; i < 3; i++) this.ambient.ducks.push({ p, a: rngC() * 6.28, r: rngC.range(3, p.r * 0.9), sp: rngC.range(0.15, 0.35) * (rngC() < 0.5 ? -1 : 1), bob: rngC() * 6 });
      // reeds around the shore
      for (let i = 0; i < 30; i++) {
        const a = rngC() * 6.28, d = p.r * rngC.range(1.2, 1.5);
        const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
        const h = this.heightAt(x, z);
        if (h < WATER_LEVEL - 0.4) continue;
        const c = this.season === 'winter' ? [0.9, 0.85, 0.7] : this.season === 'autumn' ? [1.3, 1.0, 0.6] : [1, 1, 1];
        M.reeds.add(m4.compose(m, x, h - 0.1, z, rngC() * 6.28, 0, 0, rngC.range(0.8, 1.3)), c[0], c[1], c[2]);
      }
    }

    // --- sky life ---
    for (let i = 0; i < 12; i++) this.ambient.clouds.push({ x: rngC.range(-H * 1.3, H * 1.3), z: rngC.range(-H * 1.1, H * 1.1), y: rngC.range(58, 78), s: rngC.range(0.8, 1.5), sp: rngC.range(1.2, 2.4), v: i % 3, yaw: rngC() * 6.28 });
    for (let f = 0; f < 4; f++) {
      const cx = rngC.range(-H * 0.6, H * 0.6), cz = rngC.range(-H * 0.6, H * 0.6), y = rngC.range(22, 34), R = rngC.range(25, 50), sp = rngC.range(0.12, 0.2) * (rngC() < 0.5 ? -1 : 1);
      for (let i = 0; i < 5; i++) this.ambient.birds.push({ cx, cz, y: y + rngC.range(-1, 1), R, sp, off: i * 0.06 + rngC() * 0.02, lat: (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 1.6, flap: rngC() * 6 });
    }
    // butterflies hop from flower to flower
    const flyCols = [[1, 0.6, 0.15], [0.45, 0.72, 1], [1, 0.95, 0.4], [1, 0.45, 0.75], [1, 1, 1], [0.75, 0.55, 1]];
    if (this.flowers.length) for (let i = 0; i < 46; i++) {
      const f = this.flowers[Math.floor(rngC() * this.flowers.length)];
      this.ambient.flies.push({ x: f.x, y: f.y, z: f.z, from: [f.x, f.y, f.z], to: f, t: 1, dur: 1, rest: rngC() * 3, col: flyCols[Math.floor(rngC() * flyCols.length)], ph: rngC() * 6, yaw: rngC() * 6.28 });
    }
    // seasonal drifting petals / leaves / snow
    if (S.fall) for (let i = 0; i < S.fallN * gq; i++) this.ambient.fall.push({ x: 0, y: -99, z: 0, ph: rngC() * 6.28, sp: rngC.range(0.6, 1.2), col: S.fall[Math.floor(rngC() * S.fall.length)], spin: rngC() * 6.28 });
  }

  // ---------- navigation grid ----------
  buildNav() {
    const C = (this.navC = 4);
    const N = (this.navN = Math.ceil(this.size / C));
    this.nav = new Uint8Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) this.nav[j * N + i] = this.navCellBlocked(i, j) ? 1 : 0;
    this.markReachable();
    // scouts can't climb logs: same grid with the log cells closed
    this.navScout = new Uint8Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) this.navScout[j * N + i] = this.nav[j * N + i] || (this.navCellHasLog(i, j) ? 1 : 0);
  }

  /** Flood-fill from the first spawn; cells tanks can never reach are marked 2 so bots never target them. */
  markReachable() {
    const N = this.navN, C = this.navC, nav = this.nav;
    for (const s of this.spawns) {
      // guarantee every spawn connects: open a corridor along its path to the centre
      const i = clamp(Math.floor((s.x + this.half) / C), 0, N - 1), j = clamp(Math.floor((s.z + this.half) / C), 0, N - 1);
      nav[j * N + i] = 0;
    }
    const seen = new Uint8Array(N * N);
    const s0 = this.spawns[0];
    const start = clamp(Math.floor((s0.z + this.half) / C), 0, N - 1) * N + clamp(Math.floor((s0.x + this.half) / C), 0, N - 1);
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const c = stack.pop();
      const ci = c % N, cj = (c / N) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        const k = nj * N + ni;
        if (seen[k] || nav[k]) continue;
        seen[k] = 1;
        stack.push(k);
      }
    }
    let lost = 0;
    for (let k = 0; k < N * N; k++) if (!nav[k] && !seen[k]) { nav[k] = 2; lost++; }
    this.unreachableCells = lost;
  }

  reachable(x, z) {
    const C = this.navC, N = this.navN;
    const i = Math.floor((x + this.half) / C), j = Math.floor((z + this.half) / C);
    if (i < 0 || j < 0 || i >= N || j >= N) return false;
    return this.nav[j * N + i] === 0;
  }

  navCellBlocked(i, j) {
    const C = this.navC;
    const x = -this.half + (i + 0.5) * C, z = -this.half + (j + 0.5) * C;
    if (!this.inBounds(x, z, 3)) return true;
    if (this.heightAt(x, z) < WATER_LEVEL + 0.5) return true;
    let b = false;
    this.query(x, z, 2.0, (o) => { if (!o.soft && !o.log) { b = true; return false; } });
    return b;
  }

  navCellHasLog(i, j) {
    const C = this.navC;
    let b = false;
    this.query(-this.half + (i + 0.5) * C, -this.half + (j + 0.5) * C, 2.0, (o) => { if (o.log) { b = true; return false; } });
    return b;
  }

  refreshNavAround(x, z, r) {
    const C = this.navC, N = this.navN;
    const i0 = clamp(Math.floor((x - r + this.half) / C), 0, N - 1), i1 = clamp(Math.floor((x + r + this.half) / C), 0, N - 1);
    const j0 = clamp(Math.floor((z - r + this.half) / C), 0, N - 1), j1 = clamp(Math.floor((z + r + this.half) / C), 0, N - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * N + i;
      this.nav[k] = this.navCellBlocked(i, j) ? 1 : 0;
      this.navScout[k] = this.nav[k] || (this.navCellHasLog(i, j) ? 1 : 0);
    }
  }

  /** A* on the nav grid. Returns a list of [x,z] waypoints (excluding start) or null. */
  findPath(sx, sz, tx, tz, maxIter = 4000, scout = false) {
    const C = this.navC, N = this.navN, nav = scout ? this.navScout : this.nav;
    const toCell = (x, z) => [clamp(Math.floor((x + this.half) / C), 0, N - 1), clamp(Math.floor((z + this.half) / C), 0, N - 1)];
    let [si, sj] = toCell(sx, sz);
    let [ti, tj] = toCell(tx, tz);
    const nearestFree = (i, j) => {
      if (!nav[j * N + i]) return [i, j];
      for (let r = 1; r < 6; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        const a = i + di, b = j + dj;
        if (a >= 0 && b >= 0 && a < N && b < N && !nav[b * N + a]) return [a, b];
      }
      return [i, j];
    };
    [si, sj] = nearestFree(si, sj);
    [ti, tj] = nearestFree(ti, tj);
    const start = sj * N + si, goal = tj * N + ti;
    if (start === goal) return [[tx, tz]];
    const g = this._g || (this._g = new Float32Array(N * N));
    const from = this._from || (this._from = new Int32Array(N * N));
    const seen = this._seen || (this._seen = new Uint32Array(N * N));
    const stamp = (this._navStamp = (this._navStamp || 0) + 1);
    const heap = [];
    const push = (idx, f) => {
      heap.push([f, idx]);
      let k = heap.length - 1;
      while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let k = 0;
        for (;;) {
          const l = 2 * k + 1, r = l + 1;
          let m = k;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k], heap[m]]; k = m;
        }
      }
      return top;
    };
    const hfn = (i, j) => { const dx = Math.abs(i - ti), dy = Math.abs(j - tj); return dx + dy - 0.586 * Math.min(dx, dy); };
    seen[start] = stamp; g[start] = 0; from[start] = -1;
    push(start, hfn(si, sj));
    let iter = 0, found = false;
    while (heap.length && iter++ < maxIter) {
      const [, cur] = pop();
      if (cur === goal) { found = true; break; }
      const ci = cur % N, cj = (cur / N) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        const nIdx = nj * N + ni;
        if (nav[nIdx]) continue;
        if (di && dj && (nav[cj * N + ni] || nav[nj * N + ci])) continue; // no corner cutting
        const cost = g[cur] + (di && dj ? 1.414 : 1);
        if (seen[nIdx] !== stamp || cost < g[nIdx]) {
          seen[nIdx] = stamp; g[nIdx] = cost; from[nIdx] = cur;
          push(nIdx, cost + hfn(ni, nj));
        }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let c = goal; c !== -1 && c !== start; c = from[c]) cells.push(c);
    cells.reverse();
    const pts = cells.map((c) => [-this.half + ((c % N) + 0.5) * C, -this.half + (((c / N) | 0) + 0.5) * C]);
    pts[pts.length - 1] = [tx, tz];
    // string-pull: drop waypoints that have a clear straight line
    const out = [];
    let ax = sx, az = sz, k = 0;
    while (k < pts.length) {
      let far = k;
      for (let m = pts.length - 1; m > k; m--) if (this.navLineClear(ax, az, pts[m][0], pts[m][1], scout)) { far = m; break; }
      out.push(pts[far]);
      [ax, az] = pts[far];
      k = far + 1;
    }
    return out;
  }

  navLineClear(x0, z0, x1, z1, scout = false) {
    const C = this.navC, N = this.navN, nav = scout ? this.navScout : this.nav;
    const L = Math.hypot(x1 - x0, z1 - z0), steps = Math.ceil(L / (C * 0.5));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const i = Math.floor((x0 + (x1 - x0) * t + this.half) / C), j = Math.floor((z0 + (z1 - z0) * t + this.half) / C);
      if (i < 0 || j < 0 || i >= N || j >= N || nav[j * N + i]) return false;
    }
    return true;
  }

  // ---------- per-frame dynamic decoration ----------
  updateAmbient(dt, time) {
    const rng = this.rngC;
    for (const d of this.ambient.ducks) d.a += d.sp * dt * (8 / d.r);
    for (const b of this.ambient.blades) b.a += dt * 0.6;
    for (const c of this.ambient.clouds) { c.x += c.sp * dt; if (c.x > this.half * 1.4) c.x = -this.half * 1.4; }
    for (const f of this.ambient.flies) {
      if (f.rest > 0) { f.rest -= dt; continue; }
      f.t += dt / f.dur;
      if (f.t >= 1) {
        // land, rest a moment, then flutter to another flower nearby
        f.x = f.to.x; f.y = f.to.y + 0.08; f.z = f.to.z;
        f.rest = 0.8 + rng() * 3;
        f.from = [f.x, f.y, f.z];
        let next = f.to;
        for (let k = 0; k < 12; k++) {
          const c = this.flowers[Math.floor(rng() * this.flowers.length)];
          if (c !== f.to && Math.hypot(c.x - f.x, c.z - f.z) < 16) { next = c; break; }
        }
        f.to = next;
        f.t = 0;
        f.dur = Math.max(0.8, Math.hypot(next.x - f.x, next.z - f.z) / 2.2);
        continue;
      }
      const [x0, y0, z0] = f.from, t = f.t;
      const wob = Math.sin(t * 9 + f.ph) * 0.6;
      const dx = f.to.x - x0, dz = f.to.z - z0, L = Math.hypot(dx, dz) || 1;
      f.x = lerp(x0, f.to.x, t) + (-dz / L) * wob;
      f.z = lerp(z0, f.to.z, t) + (dx / L) * wob;
      f.y = lerp(y0, f.to.y + 0.08, t) + Math.sin(t * Math.PI) * (1.2 + L * 0.06) + Math.sin(time * 7 + f.ph) * 0.12;
      f.yaw = Math.atan2(dx, dz);
    }
    // seasonal fall: drift around whatever the camera is looking at, respawning above it
    const fc = this.focus || [0, 0, 0];
    const wind = this.season === 'winter' ? 0.6 : 1.6;
    for (const p of this.ambient.fall) {
      if (p.y < this.heightAt(p.x, p.z) || Math.abs(p.x - fc[0]) > 70 || Math.abs(p.z - fc[2]) > 70) {
        p.x = fc[0] + (rng() - 0.5) * 120; p.z = fc[2] + (rng() - 0.5) * 120;
        p.y = this.heightAt(p.x, p.z) + 4 + rng() * 22;
      }
      p.ph += dt * p.sp * 2;
      p.x += (wind + Math.sin(p.ph) * 1.2) * dt;
      p.z += Math.cos(p.ph * 0.7) * 0.8 * dt;
      p.y -= (this.season === 'winter' ? 1.6 : 1.1) * p.sp * dt;
      p.spin += dt * p.sp * 3;
    }
  }

  /**
   * Does a prop (vertical cylinder x,z,rad from base to top) sit on a sight line from the camera to a
   * watched tank? `occ` = { eye: [x,y,z], pts: [[x,y,z], ...] } or null.
   */
  occludes(occ, x, z, rad, base, top) {
    if (!occ) return false;
    const [ex, ey, ez] = occ.eye;
    for (const p of occ.pts) {
      const dx = p[0] - ex, dy = p[1] - ey, dz = p[2] - ez;
      const px = ex - x, pz = ez - z;
      const a = dx * dx + dz * dz, b = 2 * (px * dx + pz * dz), c = px * px + pz * pz - rad * rad;
      let t0 = 0, t1 = 1;
      if (a < 1e-6) { if (c > 0) continue; } else {
        const disc = b * b - 4 * a * c;
        if (disc <= 0) continue;
        const q = Math.sqrt(disc);
        t0 = Math.max(0, (-b - q) / (2 * a)); t1 = Math.min(1, (-b + q) / (2 * a));
        if (t0 >= t1) continue;
      }
      const y0 = ey + dy * t0, y1 = ey + dy * t1;
      if (Math.max(y0, y1) >= base && Math.min(y0, y1) <= top) return true;
    }
    return false;
  }

  /** Ease a prop's see-through amount toward its target; returns the instance alpha (1 = solid). */
  fadeAlpha(o, hidden, dt) {
    const f = clamp((o.fade || 0) + (hidden ? dt : -dt) / GHOST_FADE_T, 0, 1);
    o.fade = f;
    return 1 - (1 - GHOST_ALPHA) * f * f * (3 - 2 * f);
  }

  drawDynamic(time, dt, focus, occ) {
    const M = this.M, m = this.tmpM, Bd = M.blob;
    this.focus = focus;
    // props between the camera and a watched tank fade smoothly down to see-through
    const solid = [M.treeRound, M.treePine, M.treeFruit], ghost = [M.treeRoundG, M.treePineG, M.treeFruitG];
    for (const t of this.trees) {
      const base = t.m[13] + (t.kind === 1 ? 1.2 : 2.0) * t.s;
      const a = this.fadeAlpha(t, this.occludes(occ, t.x, t.z, t.br * 0.95, base, t.top), dt);
      if (a < 1) ghost[t.kind].add(t.m, t.col[0], t.col[1], t.col[2], a);
      else solid[t.kind].add(t.m, t.col[0], t.col[1], t.col[2]);
      this.blob(Bd, t.x, t.z, t.br, t.top - t.m[13], 0.04 + 0.18 * (a - GHOST_ALPHA) / (1 - GHOST_ALPHA));
    }
    for (const t of this.mushrooms) {
      const a = this.fadeAlpha(t, this.occludes(occ, t.x, t.z, t.br, t.m[13] + 1.5 * t.s, t.top), dt);
      if (a < 1) M.mushroomG.add(t.m, t.col[0], t.col[1], t.col[2], a);
      else M.mushroom.add(t.m, t.col[0], t.col[1], t.col[2]);
      this.blob(Bd, t.x, t.z, t.br, 3 * t.s, 0.04 + 0.18 * (a - GHOST_ALPHA) / (1 - GHOST_ALPHA));
    }
    for (const o of this.bigProps) {
      const a = this.fadeAlpha(o, this.occludes(occ, o.x, o.z, o.rad, o.base, o.top), dt);
      (a < 1 ? o.ghost : o.mesh).add(o.m, o.col[0], o.col[1], o.col[2], a);
    }
    for (const o of this.bushes) {
      if (!o.alive) continue;
      const sq = 1 - o.squash * 0.5;
      M[o.berries ? 'bushBerry' : 'bush'].add(m4.compose(m, o.x, o.y, o.z, o.yaw, 0, 0, o.s * (1 + o.squash * 0.2), o.s * sq, o.s * (1 + o.squash * 0.2)), o.col[0], o.col[1], o.col[2]);
      this.blob(Bd, o.x, o.z, 1.45 * o.s, o.s);
    }
    for (const o of this.crates) if (o.alive) { M.crate.add(m4.compose(m, o.x, o.y, o.z, o.yaw)); this.blob(Bd, o.x, o.z, 1.5, 1.6); }
    for (const o of this.barrels) if (o.alive) {
      const flash = o.hp < 15 ? 1 + Math.sin(time * 30) * 0.5 : 1;
      M.barrel.add(m4.compose(m, o.x, o.y, o.z, o.yaw), flash, flash, flash);
      this.blob(Bd, o.x, o.z, 1.0, 1.6);
    }
    for (const d of this.ambient.ducks) {
      const x = d.p.x + Math.cos(d.a) * d.r, z = d.p.z + Math.sin(d.a) * d.r;
      if (this.heightAt(x, z) > WATER_LEVEL - 0.2) continue;
      const yaw = Math.atan2(-Math.sin(d.a) * Math.sign(d.sp), Math.cos(d.a) * Math.sign(d.sp));
      const y = WATER_LEVEL - 0.05 + Math.sin(time * 2 + d.bob) * 0.06;
      const c = d.bob > 3 ? [0.98, 0.98, 0.95] : [1, 0.88, 0.3];
      M.duck.add(m4.compose(m, x, y, z, yaw, 0, Math.sin(time * 2 + d.bob) * 0.08, 1.4), c[0], c[1], c[2]);
    }
    for (const b of this.ambient.blades) M.blades.add(m4.compose(m, b.x, b.y, b.z, b.yaw, 0, b.a));
    const cl = [];
    for (const c of this.ambient.clouds) {
      M.clouds[c.v].add(m4.compose(m, c.x, c.y, c.z, c.yaw, 0, 0, c.s), 1, 1, 1, 0.88);
      cl.push({ x: c.x, z: c.z, y: c.y, r: 13 * c.s });
    }
    this.r.setClouds(cl);
    for (const b of this.ambient.birds) {
      const a = time * b.sp - b.off * Math.sign(b.sp) * 4;
      const dir = Math.sign(b.sp);
      const fx = -Math.sin(a) * dir, fz = Math.cos(a) * dir;
      const x = b.cx + Math.cos(a) * b.R, z = b.cz + Math.sin(a) * b.R;
      const lx = x + Math.cos(a) * b.lat, lz = z + Math.sin(a) * b.lat;
      const yaw = Math.atan2(fx, fz);
      const y = b.y + Math.sin(time * 0.7 + b.off * 10) * 1.5;
      M.bird.add(m4.compose(m, lx, y, lz, yaw, 0, 0, 1.0));
      const flap = Math.sin(time * 9 + b.flap) * 0.7;
      M.wing.add(m4.compose(m, lx, y, lz, yaw, 0, flap, 1.0));
      M.wing.add(m4.compose(m, lx, y, lz, yaw + Math.PI, 0, flap, 1.0));
    }
    for (const f of this.ambient.flies) {
      const flap = f.rest > 0 ? 0.25 + Math.sin(time * 3 + f.ph) * 0.35 : Math.sin(time * 24 + f.ph) * 1.1;
      M.bfly.add(m4.compose(m, f.x, f.y, f.z, f.yaw, 0, flap, 2.2), f.col[0], f.col[1], f.col[2]);
      M.bfly.add(m4.compose(m, f.x, f.y, f.z, f.yaw + Math.PI, 0, flap, 2.2), f.col[0], f.col[1], f.col[2]);
    }
    const fs = this.season === 'winter' ? 0.16 : 0.3;
    for (const p of this.ambient.fall) {
      if (p.y < -50) continue;
      M.petal.add(m4.compose(m, p.x, p.y, p.z, p.spin, Math.sin(p.ph) * 0.9, Math.cos(p.spin) * 0.6, fs), p.col[0], p.col[1], p.col[2]);
    }
  }
}

export { T };
