// Procedural battlefield: terrain, ponds, paths, forests, farm, decorations, collision + nav grids.
import { Geo, T } from './geo.js';
import { Mesh } from './gl.js';
import { m4, makeNoise, makeRng, clamp, lerp, smooth } from './math.js';

export const WATER_LEVEL = -1.2;

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
    this.cellSize = 8;
    this.gridN = Math.ceil(this.size / this.cellSize);
    this.grid = Array.from({ length: this.gridN * this.gridN }, () => []);
    this.ponds = [];
    this.paths = [];
    this.spawns = [];
    this.pickupSpots = [];
    this.ambient = { birds: [], flies: [], ducks: [], clouds: [], blades: [] };
    this.tmpM = m4.create();
    this.layout();
    this.buildHeights();
    if (!this.headless) { this.buildTerrainMesh(); this.buildWater(); }
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
    if (e > 0.84) { const k = Math.min((e - 0.84) / 0.16, 1.6); h += k * k * 30 + n(x * 0.08, z * 0.08) * k * 6; }
    return h;
  }

  buildHeights() {
    // the height grid extends past the playable area so the horizon is mountains, never a void
    const C = (this.hc = 2.5);
    this.ext = Math.ceil((this.half + 70) / C) * C;
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

  groundColor(x, z, h, pd, slope) {
    const n = this.noise;
    const v = n(x * 0.05 + 9, z * 0.05 + 3);
    const meadow = n.fbm(x * 0.02 + 70, z * 0.02 - 20, 3);
    let c = [lerp(0.4, 0.5, v), lerp(0.66, 0.76, v), lerp(0.28, 0.32, v)];
    if (meadow > 0.6) { const k = smooth(clamp((meadow - 0.6) * 6, 0, 1)); c = [lerp(c[0], 0.62, k), lerp(c[1], 0.76, k), lerp(c[2], 0.32, k)]; }
    const forest = this.forestDensity(x, z);
    if (forest > 0.55) { const k = clamp((forest - 0.55) * 4, 0, 1); c = [lerp(c[0], 0.3, k), lerp(c[1], 0.56, k), lerp(c[2], 0.24, k)]; }
    if (pd < 4.6) { const k = 1 - smooth(clamp((pd - 2.4) / 2.2, 0, 1)); c = [lerp(c[0], 0.78, k), lerp(c[1], 0.62, k), lerp(c[2], 0.4, k)]; }
    if (h < WATER_LEVEL + 0.9) { const k = clamp((WATER_LEVEL + 0.9 - h) / 0.8, 0, 1); c = [lerp(c[0], 0.95, k), lerp(c[1], 0.86, k), lerp(c[2], 0.6, k)]; }
    if (h < WATER_LEVEL - 0.6) c = [0.62, 0.62, 0.45];
    if (slope > 0.7) { const k = smooth(clamp((slope - 0.7) * 1.5, 0, 0.8)); c = [lerp(c[0], 0.58, k), lerp(c[1], 0.6, k), lerp(c[2], 0.42, k)]; }
    if (h > 24) { const k = smooth(clamp((h - 24) / 8, 0, 1)); c = [lerp(c[0], 0.98, k), lerp(c[1], 0.98, k), lerp(c[2], 1, k)]; }
    const j = 0.98 + this.rngC() * 0.04;
    return [c[0] * j, c[1] * j, c[2] * j, 0];
  }

  forestDensity(x, z) { return this.noise.fbm(x * 0.009 + 200, z * 0.009 - 100, 3); }

  buildTerrainMesh() {
    const g = new Geo();
    const C = this.hc, N = this.hn;
    const E = this.ext;
    const P = (i, j) => [-E + i * C, this.hgt[j * N + i], -E + j * C];
    // per-vertex colours give soft blends between grass, paths, sand and rock
    const cols = new Array(N * N);
    const H = (i, j) => this.hgt[clamp(j, 0, N - 1) * N + clamp(i, 0, N - 1)];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const slope = Math.max(Math.abs(H(i + 1, j) - H(i - 1, j)), Math.abs(H(i, j + 1) - H(i, j - 1))) / (2 * C);
      cols[j * N + i] = this.groundColor(-E + i * C, -E + j * C, this.hgt[j * N + i], this.pathD[j * N + i], slope);
    }
    for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
      const a = P(i, j), b = P(i + 1, j), c = P(i, j + 1), d = P(i + 1, j + 1);
      const ca = cols[j * N + i], cb = cols[j * N + i + 1], cc = cols[(j + 1) * N + i], cd = cols[(j + 1) * N + i + 1];
      // tri 1: a, c, d  (00, 01, 11); tri 2: a, d, b (00, 11, 10)
      g.triC(a, c, d, ca, cc, cd);
      g.triC(a, d, b, ca, cd, cb);
    }
    this.buildFarRing(g);
    this.terrain = new Mesh(this.r, g, { static: true, castShadow: false });
    this.terrain.add(m4.create());
  }

  /** Distant mountain ring beyond the height grid so the horizon is never empty from any position. */
  buildFarRing(g) {
    const n = this.noise, segs = 160;
    const radii = [this.ext * 1.38, this.ext * 1.9, this.ext * 2.8, this.ext * 4.2];
    const ringH = (a, k) => {
      const ridge = n.fbm(Math.cos(a) * 3 + k * 7, Math.sin(a) * 3 - k * 5, 3);
      return [24, 55 + ridge * 70, 40 + ridge * 90, -5][k];
    };
    const col = (k, h) => {
      if (k === 3) return [0.55, 0.68, 0.78, 0];
      if (h > 70) return [0.97, 0.97, 1, 0];
      if (k === 0) return [0.38, 0.6, 0.32, 0];
      return [0.5, 0.58, 0.5, 0];
    };
    const P = (a, k) => {
      // the inner edge hides under the border hills of the height grid
      const r = radii[k] * (k === 0 ? Math.SQRT1_2 : 1) * (1 + (n(a * 4 + k, k) - 0.5) * 0.12);
      return [Math.cos(a) * r, ringH(a, k), Math.sin(a) * r];
    };
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
      for (let k = 0; k < 3; k++) {
        const p00 = P(a0, k), p01 = P(a1, k), p10 = P(a0, k + 1), p11 = P(a1, k + 1);
        g.triC(p00, p10, p11, col(k, p00[1]), col(k + 1, p10[1]), col(k + 1, p11[1]));
        g.triC(p00, p11, p01, col(k, p00[1]), col(k + 1, p11[1]), col(k, p01[1]));
      }
    }
  }

  buildWater() {
    const g = new Geo();
    const c = [0.3, 0.62, 0.9, 0];
    for (const p of this.ponds) {
      const R = p.r * 1.5 + 2, step = 3;
      for (let z = -R; z < R; z += step) for (let x = -R; x < R; x += step) {
        if (Math.hypot(x + step / 2, z + step / 2) > R + 2) continue;
        const A = [p.x + x, 0, p.z + z], B = [p.x + x + step, 0, p.z + z], Cc = [p.x + x, 0, p.z + z + step], D = [p.x + x + step, 0, p.z + z + step];
        g.tri(A, Cc, D, c); g.tri(A, D, B, c);
      }
    }
    if (g.pos.length) {
      this.water = new Mesh(this.r, g, { static: true, mode: 2, transparent: true, castShadow: false, layer: 3 });
      this.water.add(m4.compose(m4.create(), 0, WATER_LEVEL, 0), 1, 1, 1, 0.78);
    }
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
    const rng = this.rng, M = this.M, H = this.half, m = this.tmpM;
    const dens = this.cfg.trees;
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

    // --- farm in the centre ---
    const house = (x, z, yaw) => {
      const y = this.heightAt(x, z) - 0.2;
      M.house.add(m4.compose(m, x, y, z, yaw), 0.88, 0.32, 0.28, 1);
      // approximate the house with a few circles
      const c = Math.cos(yaw), s = Math.sin(yaw);
      for (const ox of [-2.4, 0, 2.4]) this.addObstacle({ x: x + c * ox, z: z - s * ox, r: 2.8, top: y + 6, kind: 'house' });
    };
    house(-12, 8, 0.3);
    const wmX = 11, wmZ = -9;
    const wy = this.heightAt(wmX, wmZ) - 0.2;
    M.windmill.add(m4.compose(m, wmX, wy, wmZ, -0.6));
    this.addObstacle({ x: wmX, z: wmZ, r: 3.2, top: wy + 14, kind: 'windmill' });
    this.ambient.blades.push({ x: wmX + Math.sin(-0.6) * 2.4, y: wy + 10.5, z: wmZ + Math.cos(-0.6) * 2.4, yaw: -0.6, a: 0 });
    for (let i = 0; i < 6; i++) {
      const x = -2 + i * 2.2, z = 16 + (i % 2) * 2.2;
      M.hay.add(m4.compose(m, x, this.heightAt(x, z) - 0.1, z, 0.2 * i));
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

    // --- rocks & boulders ---
    place(Math.round(70 * dens), 2.5, { gap: 2 }, (x, z, h) => {
      const s = rng.range(1.2, 3.6);
      const g = rng.range(0.75, 1.0);
      M.rock.add(m4.compose(m, x, h - 0.2, z, rng() * 6.28, rng() * 0.2, 0, s, s * rng.range(0.7, 1.2), s), g, g * 0.98, g * 0.95);
      this.addObstacle({ x, z, r: s * 0.95, top: h + s * 0.9, kind: 'rock' });
    });

    // --- trees: dense forests + scattered singles ---
    this.trees = [];
    const foliage = [[0.42, 0.78, 0.3], [0.32, 0.66, 0.28], [0.55, 0.82, 0.3], [0.95, 0.62, 0.2], [0.98, 0.42, 0.25], [0.8, 0.85, 0.3]];
    place(Math.round(340 * dens), 1.4, {
      gap: 2.2,
      accept: (x, z) => { const f = this.forestDensity(x, z); return rng() < (f > 0.55 ? 0.95 : 0.1); },
    }, (x, z, h) => {
      const kind = rng() < 0.45 ? 1 : rng() < 0.75 ? 0 : 2;
      const s = rng.range(0.9, 1.5);
      const col = rng() < 0.12 ? foliage[3 + Math.floor(rng() * 3)] : foliage[Math.floor(rng() * 3)];
      this.trees.push({ kind, x, z, s, top: h + 7 * s, col, m: m4.compose(m4.create(), x, h - 0.1, z, rng() * 6.28, 0, 0, s) });
      this.addObstacle({ x, z, r: 0.7 * s, top: h + 7 * s, kind: 'tree', cr: 2.4 * s, cb: h + 2.4 * s });
    });
    // backdrop trees on the border hills (no collision needed — unreachable)
    for (let i = 0; i < 260 * dens; i++) {
      const side = Math.floor(rng() * 4), t = rng.range(-H, H), d = rng.range(H * 0.88, H * 1.02);
      const x = side === 0 ? t : side === 1 ? t : side === 2 ? d : -d;
      const z = side === 0 ? d : side === 1 ? -d : t;
      const s = rng.range(1.2, 2.0);
      const col = foliage[Math.floor(rng() * 3)];
      M.treeBackdrop.add(m4.compose(m, x, this.heightAt(x, z) - 0.2, z, rng() * 6.28, 0, 0, s), col[0] * 0.9, col[1] * 0.9, col[2] * 0.9);
    }

    // --- giant mushrooms (whimsy!) ---
    place(Math.round(22 * dens), 2, { gap: 3 }, (x, z, h) => {
      const s = rng.range(0.8, 1.6);
      const c = rng() < 0.75 ? [1, 0.2, 0.18] : [0.65, 0.35, 1];
      M.mushroom.add(m4.compose(m, x, h - 0.1, z, rng() * 6.28, (rng() - 0.5) * 0.15, (rng() - 0.5) * 0.15, s), c[0], c[1], c[2]);
      this.addObstacle({ x, z, r: 0.7 * s, top: h + 3.5 * s, kind: 'mushroom', cr: 2 * s, cb: h + 2 * s });
    });

    // --- destructibles ---
    this.bushes = [];
    place(Math.round(160 * dens), 1.3, { gap: 0.8, pathClear: 3.5 }, (x, z, h) => {
      const s = rng.range(0.9, 1.6);
      const g = rng.range(0.85, 1.1);
      const o = this.addObstacle({ x, z, r: 0.9 * s, top: h + 1.3 * s, kind: 'bush', soft: true, hp: 1, s, yaw: rng() * 6.28, col: [0.38 * g, 0.72 * g, 0.3 * g], y: h - 0.1, squash: 0 });
      this.bushes.push(o);
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


    // everything below is purely cosmetic: it uses its own RNG so the server (which skips it)
    // and every client agree on obstacles and pickup spots regardless of graphics quality
    if (this.headless) return;
    const rngC = this.rngC;
    // --- small non-colliding details: flowers, grass, lily pads ---
    const petal = [[1, 0.35, 0.45], [1, 0.85, 0.2], [0.65, 0.45, 1], [1, 1, 1], [1, 0.55, 0.15], [0.4, 0.7, 1]];
    const gq = this.cfg.quality === 'low' ? 0.4 : this.cfg.quality === 'high' ? 1.4 : 1;
    let nf = 0, tries = 0;
    while (nf < 1400 * gq && tries++ < 20000) {
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
        nf++;
      }
    }
    for (let i = 0; i < 7000 * gq; i++) {
      const x = rngC.range(-H * 0.9, H * 0.9), z = rngC.range(-H * 0.9, H * 0.9);
      const h = this.heightAt(x, z);
      if (h < WATER_LEVEL + 0.5 || h > 16 || this.pathDist(x, z) < 3) continue;
      const s = rngC.range(0.8, 1.4);
      const v = this.noise(x * 0.05 + 9, z * 0.05 + 3);
      M.grass.add(m4.compose(m, x, h - 0.05, z, rngC() * 6.28, 0, 0, s, s * rngC.range(0.8, 1.4), s), lerp(0.42, 0.6, v), lerp(0.75, 0.88, v), 0.3);
    }
    for (const p of this.ponds) {
      for (let i = 0; i < 9; i++) {
        const a = rngC() * 6.28, d = rngC.range(2, p.r * 1.2);
        const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
        if (this.heightAt(x, z) > WATER_LEVEL - 0.3) continue;
        M.lily.add(m4.compose(m, x, WATER_LEVEL + 0.05, z, rngC() * 6.28, 0, 0, rngC.range(0.6, 1.3)));
      }
      for (let i = 0; i < 3; i++) this.ambient.ducks.push({ p, a: rngC() * 6.28, r: rngC.range(3, p.r * 0.9), sp: rngC.range(0.15, 0.35) * (rngC() < 0.5 ? -1 : 1), bob: rngC() * 6 });
      // reeds around the shore
      for (let i = 0; i < 26; i++) {
        const a = rngC() * 6.28, d = p.r * rngC.range(1.25, 1.5);
        const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
        const h = this.heightAt(x, z);
        M.grass.add(m4.compose(m, x, h - 0.1, z, rngC() * 6.28, 0, 0, 2.2, 3.5, 2.2), 0.55, 0.75, 0.35);
      }
    }

    // --- sky life ---
    for (let i = 0; i < 16; i++) this.ambient.clouds.push({ x: rngC.range(-H * 1.4, H * 1.4), z: rngC.range(-H * 1.4, H * 1.4), y: rngC.range(80, 120), s: rngC.range(0.9, 2.0), sp: rngC.range(1.5, 3) });
    for (let f = 0; f < 4; f++) {
      const cx = rngC.range(-H * 0.6, H * 0.6), cz = rngC.range(-H * 0.6, H * 0.6), y = rngC.range(22, 34), R = rngC.range(25, 50), sp = rngC.range(0.12, 0.2) * (rngC() < 0.5 ? -1 : 1);
      for (let i = 0; i < 5; i++) this.ambient.birds.push({ cx, cz, y: y + rngC.range(-1, 1), R, sp, off: i * 0.06 + rngC() * 0.02, lat: (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 1.6, flap: rngC() * 6 });
    }
    const flyCols = [[1, 0.6, 0.1], [0.4, 0.7, 1], [1, 1, 0.4], [1, 0.4, 0.7], [1, 1, 1]];
    for (let i = 0; i < 40; i++) {
      const x = rngC.range(-H * 0.8, H * 0.8), z = rngC.range(-H * 0.8, H * 0.8);
      this.ambient.flies.push({ hx: x, hz: z, x, z, y: 1.5, t: rngC() * 100, col: flyCols[Math.floor(rngC() * flyCols.length)], sp: rngC.range(0.6, 1.2) });
    }
  }

  // ---------- navigation grid ----------
  buildNav() {
    const C = (this.navC = 4);
    const N = (this.navN = Math.ceil(this.size / C));
    this.nav = new Uint8Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) this.nav[j * N + i] = this.navCellBlocked(i, j) ? 1 : 0;
    this.markReachable();
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
    this.query(x, z, 2.0, (o) => { if (!o.soft) { b = true; return false; } });
    return b;
  }

  refreshNavAround(x, z, r) {
    const C = this.navC, N = this.navN;
    const i0 = clamp(Math.floor((x - r + this.half) / C), 0, N - 1), i1 = clamp(Math.floor((x + r + this.half) / C), 0, N - 1);
    const j0 = clamp(Math.floor((z - r + this.half) / C), 0, N - 1), j1 = clamp(Math.floor((z + r + this.half) / C), 0, N - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.nav[j * N + i] = this.navCellBlocked(i, j) ? 1 : 0;
  }

  /** A* on the nav grid. Returns a list of [x,z] waypoints (excluding start) or null. */
  findPath(sx, sz, tx, tz, maxIter = 4000) {
    const C = this.navC, N = this.navN, nav = this.nav;
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
      for (let m = pts.length - 1; m > k; m--) if (this.navLineClear(ax, az, pts[m][0], pts[m][1])) { far = m; break; }
      out.push(pts[far]);
      [ax, az] = pts[far];
      k = far + 1;
    }
    return out;
  }

  navLineClear(x0, z0, x1, z1) {
    const C = this.navC, N = this.navN;
    const L = Math.hypot(x1 - x0, z1 - z0), steps = Math.ceil(L / (C * 0.5));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const i = Math.floor((x0 + (x1 - x0) * t + this.half) / C), j = Math.floor((z0 + (z1 - z0) * t + this.half) / C);
      if (i < 0 || j < 0 || i >= N || j >= N || this.nav[j * N + i]) return false;
    }
    return true;
  }

  // ---------- per-frame dynamic decoration ----------
  updateAmbient(dt, time) {
    for (const d of this.ambient.ducks) d.a += d.sp * dt * (8 / d.r);
    for (const b of this.ambient.blades) b.a += dt * 0.6;
    for (const c of this.ambient.clouds) { c.x += c.sp * dt; if (c.x > this.half * 1.5) c.x = -this.half * 1.5; }
    for (const f of this.ambient.flies) {
      f.t += dt * f.sp;
      f.x = f.hx + Math.sin(f.t * 0.7) * 6 + Math.sin(f.t * 1.9) * 2;
      f.z = f.hz + Math.cos(f.t * 0.5) * 6 + Math.cos(f.t * 2.3) * 2;
      f.y = this.heightAt(f.x, f.z) + 1.4 + Math.sin(f.t * 3) * 0.5;
    }
  }

  drawDynamic(time, birdsEye, camH, focus, tanks = []) {
    const M = this.M, m = this.tmpM;
    const solid = [M.treeRound, M.treePine, M.treeBirch], ghost = [M.treeRoundG, M.treePineG, M.treeBirchG];
    for (const t of this.trees) {
      let hide = false;
      if (birdsEye) {
        // the camera sits south (+z) and above: a tree just south of a tank hides it
        for (const k of tanks) {
          if (!k.alive) continue;
          const dz = t.z - k.z, dx = Math.abs(t.x - k.x);
          if (dx < 3.6 * t.s && dz > -2.5 && dz < 5.5 * t.s) { hide = true; break; }
        }
      }
      if (hide) ghost[t.kind].add(t.m, t.col[0], t.col[1], t.col[2], 0.28);
      else solid[t.kind].add(t.m, t.col[0], t.col[1], t.col[2]);
    }
    for (const o of this.bushes) {
      if (!o.alive) continue;
      const sq = 1 - o.squash * 0.5;
      M.bush.add(m4.compose(m, o.x, o.y, o.z, o.yaw, 0, 0, o.s * (1 + o.squash * 0.2), o.s * sq, o.s * (1 + o.squash * 0.2)), o.col[0], o.col[1], o.col[2]);
    }
    for (const o of this.crates) if (o.alive) M.crate.add(m4.compose(m, o.x, o.y, o.z, o.yaw));
    for (const o of this.barrels) if (o.alive) {
      const flash = o.hp < 15 ? 1 + Math.sin(time * 30) * 0.5 : 1;
      M.barrel.add(m4.compose(m, o.x, o.y, o.z, o.yaw), flash, flash, flash);
    }
    for (const d of this.ambient.ducks) {
      const x = d.p.x + Math.cos(d.a) * d.r, z = d.p.z + Math.sin(d.a) * d.r;
      if (this.heightAt(x, z) > WATER_LEVEL - 0.2) continue;
      const yaw = Math.atan2(-Math.sin(d.a) * Math.sign(d.sp), Math.cos(d.a) * Math.sign(d.sp));
      const y = WATER_LEVEL - 0.05 + Math.sin(time * 2 + d.bob) * 0.06;
      const c = d.bob > 3 ? [0.98, 0.98, 0.95] : [1, 0.9, 0.3];
      M.duck.add(m4.compose(m, x, y, z, yaw, 0, Math.sin(time * 2 + d.bob) * 0.08, 1.4), c[0], c[1], c[2]);
    }
    for (const b of this.ambient.blades) M.blades.add(m4.compose(m, b.x, b.y, b.z, b.yaw, 0, b.a));
    if (!birdsEye) {
      for (const c of this.ambient.clouds) M.cloud.add(m4.compose(m, c.x, c.y, c.z, 0, 0, 0, c.s * 1.6, c.s, c.s * 1.6));
    }
    for (const b of this.ambient.birds) {
      const a = time * b.sp - b.off * Math.sign(b.sp) * 4;
      const dir = Math.sign(b.sp);
      const fx = -Math.sin(a) * dir, fz = Math.cos(a) * dir;
      const x = b.cx + Math.cos(a) * b.R + fz * b.lat * 0, z = b.cz + Math.sin(a) * b.R;
      const lx = x + Math.cos(a) * b.lat, lz = z + Math.sin(a) * b.lat;
      const yaw = Math.atan2(fx, fz);
      const y = b.y + Math.sin(time * 0.7 + b.off * 10) * 1.5;
      M.bird.add(m4.compose(m, lx, y, lz, yaw, 0, 0, 1.0));
      const flap = Math.sin(time * 9 + b.flap) * 0.7;
      M.wing.add(m4.compose(m, lx, y, lz, yaw, 0, flap, 1.0));
      M.wing.add(m4.compose(m, lx, y, lz, yaw + Math.PI, 0, flap, 1.0));
    }
    for (const f of this.ambient.flies) {
      const yaw = Math.atan2(Math.cos(f.t * 0.7), -Math.sin(f.t * 0.5));
      const flap = Math.sin(time * 22 + f.t) * 1.1;
      M.bfly.add(m4.compose(m, f.x, f.y, f.z, yaw, 0, flap, 2.2), f.col[0], f.col[1], f.col[2]);
      M.bfly.add(m4.compose(m, f.x, f.y, f.z, yaw + Math.PI, 0, flap, 2.2), f.col[0], f.col[1], f.col[2]);
    }
  }
}

export { T };
