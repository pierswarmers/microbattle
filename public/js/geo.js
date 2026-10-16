// Procedural low-poly geometry builder. Colours are [r,g,b,tintMask].
import { m4 } from './math.js';

export class Geo {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.t = null; // optional transform applied to subsequent primitives
  }

  setT(m) { this.t = m; return this; }

  _p(p) {
    const t = this.t;
    if (!t) return p;
    return [t[0] * p[0] + t[4] * p[1] + t[8] * p[2] + t[12], t[1] * p[0] + t[5] * p[1] + t[9] * p[2] + t[13], t[2] * p[0] + t[6] * p[1] + t[10] * p[2] + t[14]];
  }

  tri(a, b, c, col) {
    a = this._p(a); b = this._p(b); c = this._p(c);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const cc = col.length === 3 ? [col[0], col[1], col[2], 0] : col;
    for (const p of [a, b, c]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(nx, ny, nz);
      this.col.push(cc[0], cc[1], cc[2], cc[3]);
    }
  }

  quad(a, b, c, d, col) { this.tri(a, b, c, col); this.tri(a, c, d, col); }

  /** Triangle with per-vertex colours (flat normal, smooth colour). */
  triC(a, b, c, ca, cb, cc) {
    const n0 = this.pos.length;
    this.tri(a, b, c, ca);
    const k = (n0 / 3) * 4;
    this.col.splice(k + 4, 8, cb[0], cb[1], cb[2], cb[3] ?? 0, cc[0], cc[1], cc[2], cc[3] ?? 0);
  }

  /** Axis-aligned box centred at (x,y,z) with full sizes (w,h,d). `taper` shrinks the top face. */
  box(x, y, z, w, h, d, col, taper = 0, topCol = null) {
    const hw = w / 2, hh = h / 2, hd = d / 2;
    const tw = hw * (1 - taper), td = hd * (1 - taper);
    const p = [
      [x - hw, y - hh, z - hd], [x + hw, y - hh, z - hd], [x + hw, y - hh, z + hd], [x - hw, y - hh, z + hd],
      [x - tw, y + hh, z - td], [x + tw, y + hh, z - td], [x + tw, y + hh, z + td], [x - tw, y + hh, z + td],
    ];
    const tc = topCol || col;
    this.quad(p[4], p[7], p[6], p[5], tc); // top
    this.quad(p[0], p[1], p[2], p[3], col); // bottom
    this.quad(p[3], p[2], p[6], p[7], col); // +z
    this.quad(p[1], p[0], p[4], p[5], col); // -z
    this.quad(p[2], p[1], p[5], p[6], col); // +x
    this.quad(p[0], p[3], p[7], p[4], col); // -x
    return this;
  }

  /** Box with a sloped front (wedge) — used for tank hulls. */
  hull(x, y, z, w, h, d, frontSlope, backSlope, col, topCol) {
    const hw = w / 2, hh = h / 2, hd = d / 2;
    const fs = frontSlope, bs = backSlope;
    const p = [
      [x - hw, y - hh, z - hd + bs], [x + hw, y - hh, z - hd + bs], [x + hw, y - hh, z + hd - fs], [x - hw, y - hh, z + hd - fs],
      [x - hw, y + hh, z - hd], [x + hw, y + hh, z - hd], [x + hw, y + hh, z + hd], [x - hw, y + hh, z + hd],
    ];
    // top is the larger face so the hull overhangs the tracks a little
    this.quad(p[4], p[7], p[6], p[5], topCol || col);
    this.quad(p[0], p[1], p[2], p[3], col);
    this.quad(p[3], p[2], p[6], p[7], col);
    this.quad(p[1], p[0], p[4], p[5], col);
    this.quad(p[2], p[1], p[5], p[6], col);
    this.quad(p[0], p[3], p[7], p[4], col);
    return this;
  }

  /** Cylinder/frustum along Y (or along Z if axis==='z'), base centre at (x,y,z). */
  cyl(x, y, z, rb, rt, h, seg, col, axis = 'y', capCol = null) {
    const P = (a, r, hh) => {
      const c = Math.cos(a) * r, s = Math.sin(a) * r;
      if (axis === 'z') return [x + c, y + s, z + hh];
      if (axis === 'x') return [x + hh, y + c, z + s];
      return [x + c, y + hh, z + s];
    };
    const cc = capCol || col;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const b0 = P(a0, rb, 0), b1 = P(a1, rb, 0), t0 = P(a0, rt, h), t1 = P(a1, rt, h);
      if (axis === 'y') {
        this.quad(b0, t0, t1, b1, col);
        if (rt > 0) this.tri(P(0, 0, h), t1, t0, cc);
        if (rb > 0) this.tri(P(0, 0, 0), b0, b1, cc);
      } else {
        this.quad(b0, b1, t1, t0, col);
        if (rt > 0) this.tri(P(0, 0, h), t0, t1, cc);
        if (rb > 0) this.tri(P(0, 0, 0), b1, b0, cc);
      }
    }
    return this;
  }

  /** Low-poly sphere (icosphere). `jitter` randomises radius for rocks/foliage. */
  sphere(x, y, z, r, detail, col, jitter = 0, rng = Math.random, sy = 1) {
    const t = (1 + Math.sqrt(5)) / 2;
    let verts = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(nrm);
    let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    for (let d = 0; d < detail; d++) {
      const cache = new Map();
      const mid = (a, b) => {
        const k = a < b ? a + '_' + b : b + '_' + a;
        if (cache.has(k)) return cache.get(k);
        const v = nrm([(verts[a][0] + verts[b][0]) / 2, (verts[a][1] + verts[b][1]) / 2, (verts[a][2] + verts[b][2]) / 2]);
        verts.push(v);
        cache.set(k, verts.length - 1);
        return verts.length - 1;
      };
      const nf = [];
      for (const [a, b, c] of faces) {
        const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
        nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
      }
      faces = nf;
    }
    const rr = verts.map(() => r * (1 + (rng() - 0.5) * 2 * jitter));
    const colFn = typeof col === 'function' ? col : () => col;
    for (const [a, b, c] of faces) {
      const P = (i) => [x + verts[i][0] * rr[i], y + verts[i][1] * rr[i] * sy, z + verts[i][2] * rr[i]];
      const cy = (verts[a][1] + verts[b][1] + verts[c][1]) / 3;
      this.tri(P(a), P(b), P(c), colFn(cy));
    }
    return this;
  }

  /** Flat disc / ring in XZ plane (for decals, shadows, rings). */
  ring(x, y, z, r0, r1, seg, col) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const p0 = [x + Math.cos(a0) * r0, y, z + Math.sin(a0) * r0], p1 = [x + Math.cos(a1) * r0, y, z + Math.sin(a1) * r0];
      const q0 = [x + Math.cos(a0) * r1, y, z + Math.sin(a0) * r1], q1 = [x + Math.cos(a1) * r1, y, z + Math.sin(a1) * r1];
      if (r0 === 0) this.tri(p0, q1, q0, col);
      else this.quad(p0, p1, q1, q0, col);
    }
    return this;
  }

  /** Append another Geo, transformed by matrix m. */
  merge(g, m = null) {
    const prev = this.t;
    this.t = m;
    for (let i = 0; i < g.pos.length; i += 9) {
      const c = g.col.slice((i / 3) * 4, (i / 3) * 4 + 4);
      this.tri(g.pos.slice(i, i + 3), g.pos.slice(i + 3, i + 6), g.pos.slice(i + 6, i + 9), c);
    }
    this.t = prev;
    return this;
  }
}

function nrm(v) { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; }

export const T = (x, y, z, yaw = 0, pitch = 0, roll = 0, s = 1, sy = s, sz = s) => m4.compose(m4.create(), x, y, z, yaw, pitch, roll, s, sy, sz);
