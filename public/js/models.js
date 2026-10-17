// All the toy-like meshes used by the game.
import { Geo, T } from './geo.js';
import { Mesh } from './gl.js';

/** Apples hanging on each fruit tree per season; they are separate instances so they can be knocked off. */
export const APPLES = { summer: 9, autumn: 5 };
const APPLE = [0.92, 0.16, 0.14, 0];

const PAINT = [1, 1, 1, 1];
const PAINT2 = [0.82, 0.82, 0.82, 1];
const PAINT3 = [0.66, 0.66, 0.66, 1];
const TRACK = [0.24, 0.21, 0.28, 0];
const WHEEL = [0.34, 0.31, 0.38, 0];
const HUB = [1, 0.8, 0.22, 0];
const CREAM = [1, 0.96, 0.86, 0];
const DARK = [0.2, 0.18, 0.24, 0];
const LIGHT = [1, 0.95, 0.6, 0];
const TRUNK = hexc('#855733');
const FOLIAGE_TOP = hexc('#80D966', 1), FOLIAGE_BOT = hexc('#47A845', 1);
const PINE = hexc('#338C59', 1);
const ROCK = hexc('#9E9EA8', 1);
const SNOW = [0.97, 0.98, 1, 0];

function hexc(h, mask = 0) { return [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255, mask]; }
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3]];

export { TANK_GEOM } from './defs.js';

/** Chunky toy treads: a rounded rubber band per side with big wheels and bright hubs. */
function tracks(g, w, len, h, y = 0) {
  for (const sx of [-1, 1]) {
    const x = sx * (w / 2);
    g.rbox(x, y + h / 2, 0, 0.66, h, len, h * 0.48, TRACK, 3);
    const n = Math.max(3, Math.round(len / 1.05));
    for (let i = 0; i < n; i++) {
      const z = -len / 2 + h * 0.5 + (i * (len - h)) / (n - 1);
      g.cyl(x + (sx > 0 ? 0.3 : -0.4), y + h * 0.48, z, h * 0.36, h * 0.36, 0.1, 10, WHEEL, 'x');
      g.cyl(x + (sx > 0 ? 0.38 : -0.44), y + h * 0.48, z, h * 0.15, h * 0.15, 0.06, 8, HUB, 'x');
    }
  }
}

function antenna(g, x, y, z, h) {
  g.cyl(x, y, z, 0.05, 0.04, h, 5, DARK);
  g.sphere(x, y + h, z, 0.13, 1, PAINT2);
}

function headlights(g, w, y, z) {
  for (const sx of [-1, 1]) g.sphere(sx * w, y, z, 0.17, 1, LIGHT, 0, Math.random, 0.9);
}

/** Barrel with a collar at the base and a rounded muzzle tip. */
function gun(g, x, len, r, col = PAINT2, tip = DARK) {
  g.cyl(x, 0, 0, r, r * 0.92, len, 10, col, 'z');
  g.cyl(x, 0, len - r * 1.6, r * 1.45, r * 1.45, r * 1.6, 10, col, 'z');
  g.cyl(x, 0, len - 0.02, r * 0.75, r * 0.75, 0.04, 10, tip, 'z');
}

function buildTank(type) {
  const hull = new Geo(), turret = new Geo(), barrel = new Geo();
  if (type === 'scout') {
    tracks(hull, 2.0, 3.0, 0.8);
    hull.rbox(0, 0.98, 0.05, 1.75, 0.6, 3.05, 0.28, PAINT);
    hull.rbox(0, 1.22, -1.05, 1.2, 0.2, 0.55, 0.1, PAINT2);
    hull.rbox(0, 0.75, 1.5, 1.5, 0.3, 0.25, 0.12, CREAM);
    headlights(hull, 0.55, 1.05, 1.55);
    turret.sphere(0, 0.05, 0, 0.78, 2, PAINT, 0, Math.random, 0.62);
    turret.sphere(0, 0.42, -0.15, 0.32, 1, CREAM, 0, Math.random, 0.7);
    antenna(turret, -0.42, 0.3, -0.35, 1.0);
    for (const sx of [-0.15, 0.15]) gun(barrel, sx, 1.9, 0.085);
    barrel.rbox(0, 0, 0.18, 0.5, 0.28, 0.42, 0.1, PAINT3);
  } else if (type === 'standard') {
    tracks(hull, 2.4, 3.7, 0.9);
    hull.rbox(0, 1.12, 0, 2.15, 0.7, 3.6, 0.32, PAINT);
    for (const sx of [-1, 1]) hull.rbox(sx * 1.2, 1.0, 0, 0.5, 0.16, 3.5, 0.08, PAINT2);
    headlights(hull, 0.7, 1.15, 1.8);
    hull.rbox(-0.75, 1.5, -1.35, 0.5, 0.3, 0.55, 0.12, CREAM);
    turret.rbox(0, 0.3, -0.05, 1.65, 0.62, 1.85, 0.3, PAINT);
    turret.cyl(0.42, 0.58, -0.35, 0.3, 0.27, 0.16, 10, PAINT2);
    turret.sphere(0.42, 0.74, -0.35, 0.18, 1, CREAM, 0, Math.random, 0.6);
    antenna(turret, -0.55, 0.6, -0.65, 1.2);
    gun(barrel, 0, 2.7, 0.16);
    barrel.cyl(0, 0, 0, 0.3, 0.27, 0.45, 10, PAINT3, 'z');
  } else if (type === 'superheavy') {
    tracks(hull, 2.9, 4.2, 1.05);
    hull.rbox(0, 1.32, 0, 2.6, 0.85, 4.1, 0.38, PAINT);
    for (const sx of [-1, 1]) hull.rbox(sx * 1.45, 1.05, 0, 0.3, 0.5, 3.8, 0.14, PAINT2);
    // chunky toy bulldozer plow
    hull.rbox(0, 0.62, 2.35, 3.2, 0.72, 0.38, 0.17, CREAM);
    headlights(hull, 0.95, 1.35, 2.08);
    turret.rbox(0, 0.38, -0.1, 2.2, 0.8, 2.4, 0.38, PAINT);
    turret.rbox(0, 0.42, -1.4, 1.5, 0.5, 0.5, 0.2, PAINT2);
    turret.cyl(-0.55, 0.76, -0.4, 0.38, 0.33, 0.2, 10, PAINT2);
    turret.sphere(-0.55, 0.96, -0.4, 0.22, 1, CREAM, 0, Math.random, 0.6);
    antenna(turret, 0.8, 0.76, -1.0, 1.3);
    gun(barrel, 0, 3.1, 0.24);
    barrel.rbox(0, 0, 2.95, 0.66, 0.4, 0.5, 0.15, PAINT3);
    barrel.cyl(0, 0, 0, 0.44, 0.38, 0.65, 10, PAINT3, 'z');
  } else if (type === 'artillery') {
    tracks(hull, 2.6, 3.9, 0.9);
    hull.rbox(0, 1.1, 0, 2.35, 0.68, 3.85, 0.32, PAINT);
    hull.rbox(0, 1.48, 1.3, 1.5, 0.22, 0.8, 0.1, PAINT2);
    headlights(hull, 0.8, 1.15, 1.9);
    for (const sx of [-1, 1]) hull.sphere(sx * 1.35, 0.55, -1.75, 0.28, 1, HUB, 0, Math.random, 0.8);
    turret.cyl(0, 0, 0, 1.15, 1.08, 0.5, 14, PAINT, 'y', PAINT2);
    turret.sphere(0, 0.5, -0.1, 0.95, 2, PAINT, 0, Math.random, 0.45);
    for (const sx of [-1, 1]) turret.rbox(sx * 0.66, 0.6, 0.1, 0.24, 0.8, 1.2, 0.1, PAINT2);
    antenna(turret, -0.7, 0.45, -0.8, 1.1);
    barrel.cyl(0, 0, -0.5, 0.44, 0.4, 2.5, 14, PAINT2, 'z');
    barrel.cyl(0, 0, 1.6, 0.54, 0.54, 0.4, 14, PAINT3, 'z');
    barrel.cyl(0, 0, 1.98, 0.3, 0.3, 0.04, 12, DARK, 'z');
    barrel.cyl(0, 0, -0.6, 0.52, 0.52, 0.5, 14, PAINT3, 'z');
  }
  for (const g of [hull, turret, barrel]) g.smooth(55);
  return { hull, turret, barrel };
}

/** Deciduous trees bake the green gradient in; the instance colour then only nudges (or re-seasons) it. */
function tree(kind, rng, season) {
  const g = new Geo();
  const top = [];
  if (kind === 'round' || kind === 'fruit') {
    g.cyl(0, 0, 0, 0.42, 0.3, 3.1, 7, TRUNK);
    const fc = (y) => mixc(FOLIAGE_BOT, FOLIAGE_TOP, Math.min(1, Math.max(0, y * 0.55 + 0.55)));
    for (const [x, y, z, r] of [[0, 4.3, 0, 2.2], [1.25, 3.55, 0.45, 1.55], [-1.05, 3.75, -0.6, 1.6]]) {
      g.sphere(x, y, z, r, 1, fc, 0.13, rng);
      top.push([x, y, z, r]);
    }
  } else if (kind === 'pine') {
    g.cyl(0, 0, 0, 0.35, 0.25, 1.8, 6, TRUNK);
    const shades = [0.82, 0.92, 1.04];
    [[1.2, 2.4, 2.6], [2.5, 1.85, 2.3], [3.7, 1.3, 2.0]].forEach(([y, r, h], i) => {
      g.cyl(0, y, 0, r, 0, h, 7, mixc([0, 0, 0, 1], PINE, shades[i]).map((v, k) => (k < 3 ? Math.min(1, v) : 1)));
      if (season === 'winter') g.cyl(0, y + h * 0.62, 0, r * 0.42, 0, h * 0.4, 7, SNOW);
    });
  }
  if (top.length) {
    for (const [x, y, z, r] of top) {
      if (season === 'winter') g.sphere(x, y + r * 0.55, z, r * 0.78, 1, SNOW, 0.08, rng, 0.45);
    }
    if (kind === 'fruit' && season !== 'winter') {
      // spring blossom or summer apples dotted over the canopy (autumn keeps a few late apples)
      // apples are only recorded here (drawn per instance by the world) so they can fall off
      const n = season === 'spring' ? 30 : APPLES[season];
      g.apples = [];
      for (let i = 0; i < n; i++) {
        const [x, y, z, r] = top[i % top.length];
        const a = rng() * 6.28, e = (rng() - 0.2) * 1.2;
        const p = [x + Math.cos(a) * Math.cos(e) * r * 0.98, y + Math.sin(e) * r * 0.98, z + Math.sin(a) * Math.cos(e) * r * 0.98];
        if (season === 'spring') g.sphere(p[0], p[1], p[2], 0.26, 1, [1, 0.72, 0.84, 0]);
        else g.apples.push(p);
      }
    }
  }
  return g;
}

/** One apple at its centre: same ball as the old baked-in ones, plus a stalk and a leaf. */
function apple() {
  const g = new Geo();
  g.sphere(0, 0, 0, 0.24, 1, APPLE);
  g.cyl(0, 0.18, 0, 0.03, 0.025, 0.14, 4, [0.4, 0.26, 0.14, 0]);
  g.sphere(0.07, 0.29, 0, 0.07, 0, [0.35, 0.7, 0.25, 0], 0, Math.random, 0.4);
  return g;
}

function bush(rng, berries, season) {
  const g = new Geo();
  const c = (y) => [0.82 + y * 0.18, 0.82 + y * 0.18, 0.82 + y * 0.18, 1];
  g.sphere(-0.35, 0.45, 0, 0.85, 1, c, 0.14, rng, 0.72);
  g.sphere(0.5, 0.36, 0.15, 0.68, 1, c, 0.14, rng, 0.72);
  if (season === 'winter') { g.sphere(-0.35, 0.82, 0, 0.6, 1, SNOW, 0.08, rng, 0.35); g.sphere(0.5, 0.65, 0.15, 0.46, 1, SNOW, 0.08, rng, 0.35); }
  if (berries) {
    for (let i = 0; i < 7; i++) {
      const a = rng() * 6.28, cx = i % 2 ? -0.35 : 0.5, r = i % 2 ? 0.8 : 0.64;
      g.sphere(cx + Math.cos(a) * r, 0.35 + rng() * 0.3, Math.sin(a) * r, 0.12, 1, [0.95, 0.15, 0.22, 0]);
    }
  }
  return g;
}

function mushroom(rng) {
  const g = new Geo();
  g.cyl(0, 0, 0, 0.55, 0.45, 2.2, 8, [0.98, 0.94, 0.85, 0]);
  const cap = new Geo();
  cap.sphere(0, 0, 0, 2.0, 1, (y) => (y < -0.1 ? [0.98, 0.92, 0.8, 0] : [1, 1, 1, 1]), 0, rng, 0.55);
  g.merge(cap, T(0, 2.2, 0));
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * 6.28 + rng();
    const rr = 0.8 + rng() * 0.8;
    g.sphere(Math.cos(a) * rr, 2.2 + Math.sqrt(Math.max(0, 1 - (rr / 2.05) ** 2)) * 1.05, Math.sin(a) * rr, 0.28, 0, [1, 1, 1, 0], 0, rng, 0.5);
  }
  g.sphere(0, 3.3, 0, 0.32, 0, [1, 1, 1, 0], 0, rng, 0.5);
  return g;
}

/** Little red-cap, white-spot toadstool for scattering. */
function toadstool(rng) {
  const g = new Geo();
  g.cyl(0, 0, 0, 0.11, 0.09, 0.42, 7, [0.98, 0.95, 0.86, 0]);
  g.sphere(0, 0.42, 0, 0.3, 1, (y) => (y < -0.1 ? [0.98, 0.92, 0.8, 0] : [0.92, 0.14, 0.12, 0]), 0, rng, 0.6);
  for (let i = 0; i < 4; i++) { const a = (i / 4) * 6.28 + 0.4; g.sphere(Math.cos(a) * 0.17, 0.53, Math.sin(a) * 0.17, 0.05, 0, [1, 1, 1, 0], 0, rng, 0.5); }
  g.sphere(0, 0.6, 0, 0.055, 0, [1, 1, 1, 0], 0, rng, 0.5);
  return g;
}

function flower(rng) {
  const g = new Geo();
  g.cyl(0, 0, 0, 0.04, 0.03, 0.7, 4, [0.3, 0.65, 0.25, 0]);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * 6.28;
    g.sphere(Math.cos(a) * 0.17, 0.72, Math.sin(a) * 0.17, 0.13, 0, [1, 1, 1, 1], 0, rng, 0.4);
  }
  g.sphere(0, 0.75, 0, 0.1, 0, [1, 0.79, 0.2, 0], 0, rng, 0.6);
  return g;
}

/** Grass tuft: four slim pyramid blades leaning out from the middle. */
function grass(rng) {
  const g = new Geo();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * 6.28 + rng() * 0.8;
    const h = 0.55 + rng() * 0.35, lean = 0.12 + rng() * 0.12, w = 0.07;
    const bx = Math.cos(a) * 0.06, bz = Math.sin(a) * 0.06;
    const tip = [bx + Math.cos(a) * lean, h, bz + Math.sin(a) * lean];
    const b = [0, 1, 2].map((k) => [bx + Math.cos(a + (k * 6.28) / 3) * w, 0, bz + Math.sin(a + (k * 6.28) / 3) * w]);
    const shade = 0.88 + rng() * 0.18;
    const c = [shade, shade, shade, 1], cb = [shade * 0.7, shade * 0.7, shade * 0.7, 1];
    for (let k = 0; k < 3; k++) g.triC(b[k], b[(k + 1) % 3], tip, cb, cb, c);
  }
  // light the blades like the ground beneath them so tufts read as bright grass, not dark scratches
  for (let i = 0; i < g.nor.length; i += 3) { g.nor[i] = 0; g.nor[i + 1] = 1; g.nor[i + 2] = 0; }
  return g;
}

function reeds(rng) {
  const g = new Geo();
  for (let i = 0; i < 4; i++) {
    const a = rng() * 6.28, r = rng() * 0.3, x = Math.cos(a) * r, z = Math.sin(a) * r;
    const h = 1.4 + rng() * 0.9;
    g.cyl(x, 0, z, 0.045, 0.03, h, 4, [0.42, 0.66, 0.3, 0]);
    if (i % 2 === 0) g.cyl(x, h - 0.5, z, 0.09, 0.09, 0.4, 6, [0.52, 0.33, 0.2, 0]);
  }
  return g;
}

function rock(rng, season) {
  const g = new Geo();
  const c = (y) => (season === 'winter' && y > 0.55 ? SNOW : [ROCK[0] * (0.88 + y * 0.12), ROCK[1] * (0.88 + y * 0.12), ROCK[2] * (0.88 + y * 0.12), 1]);
  g.sphere(0, 0.3, 0, 1, 1, c, 0.22, rng, 0.75);
  return g;
}

function log(rng) {
  const g = new Geo();
  g.cyl(-1.4, 0.38, 0, 0.38, 0.34, 2.8, 8, [0.48, 0.32, 0.2, 0], 'x', hexc('#D9A86C'));
  g.cyl(0.2, 0.55, 0.25, 0.1, 0.08, 0.5, 5, [0.48, 0.32, 0.2, 0], 'z');
  g.sphere(-0.6, 0.72, 0.05, 0.16, 1, [0.4, 0.75, 0.32, 0], 0.1, rng, 0.5);
  return g;
}

/** Wooden fence post for the island rim. */
function post() {
  const g = new Geo();
  g.box(0, 0.6, 0, 0.32, 1.2, 0.32, [0.72, 0.52, 0.34, 0]);
  g.cyl(0, 1.2, 0, 0.23, 0, 0.3, 4, [0.78, 0.58, 0.38, 0]);
  return g;
}

function crate() {
  const g = new Geo();
  const w = [0.78, 0.55, 0.3, 0], d = [0.55, 0.36, 0.18, 0];
  g.box(0, 0.8, 0, 1.6, 1.6, 1.6, w);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.box(sx * 0.75, 0.8, sz * 0.75, 0.16, 1.64, 0.16, d);
  for (const sy of [0.06, 1.54]) {
    g.box(0, sy, 0.75, 1.64, 0.14, 0.16, d); g.box(0, sy, -0.75, 1.64, 0.14, 0.16, d);
    g.box(0.75, sy, 0, 0.16, 0.14, 1.64, d); g.box(-0.75, sy, 0, 0.16, 0.14, 1.64, d);
  }
  return g;
}

function barrelMesh() {
  const g = new Geo();
  g.cyl(0, 0, 0, 0.62, 0.62, 1.6, 12, [0.92, 0.18, 0.12, 0], 'y', [0.75, 0.15, 0.1, 0]);
  g.cyl(0, 0.3, 0, 0.65, 0.65, 0.12, 12, [0.95, 0.95, 0.9, 0]);
  g.cyl(0, 1.2, 0, 0.65, 0.65, 0.12, 12, [0.95, 0.95, 0.9, 0]);
  g.box(0, 0.76, 0.62, 0.5, 0.5, 0.04, [1, 0.85, 0.1, 0]);
  return g;
}

function haybale() {
  const g = new Geo();
  g.cyl(-0.9, 0.9, 0, 0.9, 0.9, 1.8, 12, [0.95, 0.8, 0.35, 0], 'x', [0.88, 0.7, 0.3, 0]);
  return g;
}

function house(rng) {
  const g = new Geo();
  const wall = [0.98, 0.93, 0.82, 0], roof = [1, 1, 1, 1], wood = [0.55, 0.35, 0.2, 0];
  g.box(0, 2, 0, 7, 4, 5, wall);
  // gabled roof
  const r0 = [-3.8, 4, -2.9], r1 = [3.8, 4, -2.9], r2 = [3.8, 4, 2.9], r3 = [-3.8, 4, 2.9], rt0 = [-3.8, 6.6, 0], rt1 = [3.8, 6.6, 0];
  g.quad(r3, r2, rt1, rt0, roof);
  g.quad(r1, r0, rt0, rt1, roof);
  g.tri([-3.5, 4, 2.5], [-3.5, 6.3, 0], [-3.5, 4, -2.5], wall);
  g.tri([3.5, 4, -2.5], [3.5, 6.3, 0], [3.5, 4, 2.5], wall);
  g.box(0, 1.2, 2.52, 1.2, 2.4, 0.1, wood);
  for (const x of [-2.3, 2.3]) {
    g.box(x, 2.4, 2.52, 1.2, 1.1, 0.08, [0.5, 0.75, 0.95, 0]);
    g.box(x, 2.4, 2.56, 1.3, 0.12, 0.08, wood);
  }
  g.box(2.2, 6.3, 0.6, 0.7, 1.6, 0.7, [0.75, 0.35, 0.3, 0]);
  return g;
}

function windmillTower() {
  const g = new Geo();
  g.cyl(0, 0, 0, 3.0, 1.9, 11, 10, [0.98, 0.96, 0.9, 0]);
  g.cyl(0, 11, 0, 2.3, 0, 3.0, 10, [0.85, 0.25, 0.22, 0]);
  g.box(0, 1.4, 2.75, 1.3, 2.8, 0.2, [0.5, 0.3, 0.18, 0]);
  g.box(0, 6.5, 2.35, 0.9, 0.9, 0.2, [0.5, 0.75, 0.95, 0]);
  g.cyl(0, 10.5, 1.6, 0.35, 0.35, 1.2, 8, [0.4, 0.3, 0.2, 0], 'z');
  return g;
}

function windmillBlades() {
  const g = new Geo();
  const wood = [0.6, 0.42, 0.25, 0], sail = [1, 0.97, 0.9, 0];
  g.cyl(0, 0, -0.2, 0.55, 0.55, 0.5, 8, [0.85, 0.25, 0.22, 0], 'z');
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    g.setT(T(0, 0, 0, 0, 0, a));
    g.box(0, 4.2, 0, 0.25, 8.0, 0.18, wood);
    g.box(0.75, 4.8, 0.05, 1.3, 6.0, 0.08, sail);
    g.setT(null);
  }
  return g;
}

function fence() {
  const g = new Geo();
  const w = [0.85, 0.75, 0.6, 0];
  for (const x of [-1.9, 0, 1.9]) g.box(x, 0.6, 0, 0.18, 1.2, 0.18, w);
  g.box(0, 0.85, 0, 4, 0.14, 0.08, w);
  g.box(0, 0.45, 0, 4, 0.14, 0.08, w);
  return g;
}

/** Cloud: a cluster of squashed white spheres (n = 4..8). */
function cloud(rng, n) {
  const g = new Geo();
  const c = [1, 1, 1, 0];
  g.sphere(0, 0, 0, 5.5, 2, c, 0, rng, 0.62);
  for (let i = 1; i < n; i++) {
    const a = (i / (n - 1)) * 6.28 + rng() * 0.6, d = 4 + rng() * 3.5;
    g.sphere(Math.cos(a) * d * 1.3, (rng() - 0.35) * 2.2, Math.sin(a) * d * 0.7, 3 + rng() * 2, 2, c, 0, rng, 0.62);
  }
  return g.smooth(80);
}

function bird() {
  const g = new Geo();
  g.sphere(0, 0, 0, 0.25, 0, [0.95, 0.95, 0.95, 0], 0, Math.random, 0.8);
  g.box(0, 0, 0.3, 0.08, 0.08, 0.25, [1, 0.7, 0.2, 0]);
  return g;
}

function wing() {
  const g = new Geo();
  g.tri([0, 0, -0.2], [0, 0, 0.2], [0.9, 0.1, -0.1], [0.92, 0.92, 0.95, 0]);
  return g;
}

function butterflyWing() {
  const g = new Geo();
  g.tri([0, 0, -0.05], [0, 0, 0.12], [0.3, 0, 0.25], [1, 1, 1, 1]);
  g.tri([0, 0, -0.05], [0.25, 0, -0.22], [0, 0, 0.05], [1, 1, 1, 1]);
  g.tri([0, 0, 0.02], [0, 0, 0.12], [0.2, 0, 0.16], [0.25, 0.2, 0.3, 0]);
  return g;
}

/** Tiny flat petal / leaf for drifting seasonal particles. */
function petal() {
  const g = new Geo();
  g.quad([-0.5, 0, -0.3], [0.5, 0, -0.3], [0.5, 0, 0.3], [-0.5, 0, 0.3], [1, 1, 1, 1]);
  return g;
}

function duck(rng) {
  const g = new Geo();
  g.sphere(0, 0.25, 0, 0.45, 1, [1, 1, 1, 1], 0, rng, 0.7);
  g.sphere(0, 0.72, 0.32, 0.25, 1, [1, 1, 1, 1], 0, rng);
  g.box(0, 0.68, 0.6, 0.16, 0.07, 0.2, [1, 0.55, 0.1, 0]);
  g.box(0, 0.38, -0.45, 0.2, 0.12, 0.2, [1, 1, 1, 1], 0.3);
  return g;
}

function lilypad() {
  const g = new Geo();
  g.ring(0, 0, 0, 0, 1, 10, [0.3, 0.7, 0.3, 0]);
  g.sphere(0.3, 0.1, 0.2, 0.2, 0, [1, 0.6, 0.85, 0], 0, Math.random, 0.6);
  return g;
}

function healthPack() {
  const g = new Geo();
  g.box(0, 0, 0, 1.6, 1.1, 1.2, [1, 1, 1, 0]);
  const red = [1, 0.12, 0.15, 0];
  for (const z of [-0.61, 0.61]) { g.box(0, 0, z, 0.9, 0.28, 0.04, red); g.box(0, 0, z, 0.28, 0.9, 0.04, red); }
  g.box(0, 0.56, 0, 0.9, 0.04, 0.28, red); g.box(0, 0.56, 0, 0.28, 0.04, 0.9, red);
  g.box(0, 0.7, 0, 0.6, 0.15, 0.15, [0.4, 0.4, 0.4, 0]);
  return g;
}

function ammoPack() {
  const g = new Geo();
  g.box(0, -0.15, 0, 1.6, 0.8, 1.1, [0.45, 0.5, 0.25, 0]);
  for (let i = 0; i < 4; i++) {
    const x = -0.55 + i * 0.37;
    g.cyl(x, 0.25, 0, 0.14, 0.14, 0.5, 8, [0.9, 0.7, 0.2, 0]);
    g.cyl(x, 0.75, 0, 0.14, 0, 0.25, 8, [0.85, 0.5, 0.25, 0]);
  }
  g.box(0, -0.15, 0.56, 1.0, 0.22, 0.04, [1, 0.9, 0.2, 0]);
  return g;
}

function weaponCrate() {
  const g = new Geo();
  g.box(0, 0, 0, 1.5, 1.2, 1.5, [1, 0.6, 0.15, 0]);
  const dk = [0.25, 0.2, 0.2, 0];
  for (let i = -1; i <= 1; i++) { g.box(i * 0.5, 0, 0.76, 0.18, 1.2, 0.04, dk); g.box(0.76, 0, i * 0.5, 0.04, 1.2, 0.18, dk); g.box(i * 0.5, 0, -0.76, 0.18, 1.2, 0.04, dk); g.box(-0.76, 0, i * 0.5, 0.04, 1.2, 0.18, dk); }
  g.box(0, 0.62, 0, 1.0, 0.06, 1.0, dk);
  return g;
}

function gem() {
  const g = new Geo();
  g.sphere(0, 0, 0, 0.85, 0, [1, 1, 1, 1], 0, Math.random, 1.3);
  return g;
}

function parachute() {
  const g = new Geo();
  for (let i = 0; i < 8; i++) {
    const a0 = (i / 8) * Math.PI * 2, a1 = ((i + 1) / 8) * Math.PI * 2;
    const c = i % 2 ? [1, 1, 1, 0] : [1, 1, 1, 1];
    const R = 2.6;
    g.tri([0, 1.2, 0], [Math.cos(a1) * R, 0, Math.sin(a1) * R], [Math.cos(a0) * R, 0, Math.sin(a0) * R], c);
  }
  return g;
}

function rocketMesh() {
  const g = new Geo();
  g.cyl(0, 0, -0.5, 0.14, 0.14, 0.8, 6, [0.92, 0.92, 0.9, 0], 'z');
  g.cyl(0, 0, 0.3, 0.14, 0, 0.35, 6, [0.95, 0.2, 0.15, 0], 'z');
  for (let i = 0; i < 4; i++) { g.setT(T(0, 0, 0, 0, 0, (i * Math.PI) / 2)); g.box(0, 0.2, -0.45, 0.03, 0.25, 0.25, [0.95, 0.2, 0.15, 0]); g.setT(null); }
  return g;
}

function mineMesh() {
  const g = new Geo();
  g.cyl(0, 0, 0, 0.7, 0.55, 0.22, 10, [0.32, 0.34, 0.3, 0]);
  g.sphere(0, 0.25, 0, 0.16, 0, [1, 1, 1, 1], 0, Math.random, 0.7);
  return g;
}

function bombMesh() {
  const g = new Geo();
  g.cyl(0, 0, -0.9, 0.35, 0.35, 1.4, 8, [0.3, 0.38, 0.25, 0], 'z');
  g.cyl(0, 0, 0.5, 0.35, 0.05, 0.6, 8, [0.3, 0.38, 0.25, 0], 'z');
  g.cyl(0, 0, -0.3, 0.37, 0.37, 0.15, 8, [1, 0.85, 0.1, 0], 'z');
  for (let i = 0; i < 4; i++) { g.setT(T(0, 0, 0, 0, 0, (i * Math.PI) / 2)); g.box(0, 0.3, -0.9, 0.04, 0.4, 0.4, [0.25, 0.3, 0.2, 0]); g.setT(null); }
  return g;
}

function nukeMesh() {
  const g = new Geo();
  g.sphere(0, 0, 0, 0.7, 1, (y) => [1, 0.85, 0.1, 0], 0, Math.random, 1);
  g.cyl(0, 0, -0.2, 0.72, 0.72, 0.25, 10, [0.12, 0.12, 0.12, 0], 'z');
  g.cyl(0, 0, -1.2, 0.3, 0.55, 0.6, 8, [0.12, 0.12, 0.12, 0], 'z');
  for (let i = 0; i < 4; i++) { g.setT(T(0, 0, 0, 0, 0, (i * Math.PI) / 2)); g.box(0, 0.45, -1.1, 0.05, 0.5, 0.5, [1, 0.85, 0.1, 0]); g.setT(null); }
  return g;
}

function jetMesh() {
  const g = new Geo();
  const body = [0.55, 0.6, 0.68, 0], dark = [0.3, 0.33, 0.38, 0], glass = [0.4, 0.75, 1, 0];
  g.cyl(0, 0, -3, 0.6, 0.45, 5.5, 8, body, 'z');
  g.cyl(0, 0, 2.5, 0.45, 0.05, 1.6, 8, body, 'z');
  g.sphere(0, 0.45, 1.6, 0.45, 1, glass, 0, Math.random, 0.8);
  g.box(0, -0.05, -0.3, 7, 0.12, 1.8, body, 0.1);
  g.box(0, 0.9, -2.7, 0.12, 1.6, 1.0, dark);
  g.box(0, 0.1, -2.8, 2.6, 0.1, 0.8, body);
  for (const x of [-1.6, 1.6]) g.cyl(x, -0.35, -0.5, 0.18, 0.18, 0.9, 6, dark, 'z');
  g.box(0, -0.35, 0.2, 0.15, 0.3, 0.6, [1, 0.25, 0.2, 0]);
  return g;
}

/** Create every mesh. Returns a dictionary of Mesh instances. */
export function createModels(r, rng, season = 'summer') {
  const M = {};
  M.tanks = {};
  for (const type of ['scout', 'standard', 'artillery', 'superheavy']) {
    const t = buildTank(type);
    M.tanks[type] = {
      hull: new Mesh(r, t.hull, { capacity: 8, outlineMax: 0.12 }),
      turret: new Mesh(r, t.turret, { capacity: 8, outlineMax: 0.12 }),
      barrel: new Mesh(r, t.barrel, { capacity: 8, outlineMax: 0.1 }),
    };
  }
  M.terrain = null; // set by world
  // big props are re-submitted each frame so ones hiding a tank from the camera can fade to see-through
  // "G" ghost twins: depth-prepassed, outlined, alpha-blended copies of the same geometry
  const tr = tree('round', rng, season), tp = tree('pine', rng, season), tf = tree('fruit', rng, season);
  M.treeRound = new Mesh(r, tr, { sway: 0.0035, capacity: 512 });
  M.treePine = new Mesh(r, tp, { sway: 0.0035, capacity: 512 });
  M.treeFruit = new Mesh(r, tf, { sway: 0.0035, capacity: 256 });
  const ghost = { sway: 0.0035, capacity: 32, ghost: true, layer: 8 };
  M.treeRoundG = new Mesh(r, tr, ghost);
  M.treePineG = new Mesh(r, tp, ghost);
  M.treeFruitG = new Mesh(r, tf, ghost);
  M.mushroomG = new Mesh(r, mushroom(rng), { capacity: 16, ghost: true, layer: 8 });
  M.appleSpots = tf.apples || [];
  M.apple = new Mesh(r, apple(), { capacity: 1024, outlineMax: 0.04 });
  M.appleG = new Mesh(r, apple(), { capacity: 64, ghost: true, layer: 8 });
  M.bush = new Mesh(r, bush(rng, false, season), { capacity: 256 });
  M.bushBerry = new Mesh(r, bush(rng, season !== 'winter', season), { capacity: 256 });
  const rk = rock(rng, season);
  M.rock = new Mesh(r, rk, { static: true, capacity: 256 });
  M.boulder = new Mesh(r, rk, { capacity: 128 });
  M.boulderG = new Mesh(r, rk, { capacity: 16, ghost: true, layer: 8 });
  M.mushroom = new Mesh(r, mushroom(rng), { capacity: 64 });
  M.toadstool = new Mesh(r, toadstool(rng), { static: true, capacity: 512, outlineMax: 0.05 });
  M.log = new Mesh(r, log(rng), { static: true, capacity: 64 });
  M.post = new Mesh(r, post(), { static: true, capacity: 256 });
  M.flower = new Mesh(r, flower(rng), { static: true, sway: 0.25, outline: false, capacity: 2048 });
  M.grass = new Mesh(r, grass(rng), { static: true, sway: 0.32, cull: false, mode: 7, capacity: 8192 });
  M.reeds = new Mesh(r, reeds(rng), { static: true, sway: 0.08, outline: false, capacity: 256 });
  M.crate = new Mesh(r, crate(), { capacity: 64 });
  M.barrel = new Mesh(r, barrelMesh(), { capacity: 64 });
  M.hay = new Mesh(r, haybale(), { static: true, capacity: 64 });
  const hs = house(rng), wm = windmillTower();
  M.house = new Mesh(r, hs, { capacity: 8 });
  M.houseG = new Mesh(r, hs, { capacity: 4, ghost: true, layer: 8 });
  M.windmill = new Mesh(r, wm, { capacity: 4 });
  M.windmillG = new Mesh(r, wm, { capacity: 4, ghost: true, layer: 8 });
  M.blades = new Mesh(r, windmillBlades(), { capacity: 4, cull: false });
  M.fence = new Mesh(r, fence(), { static: true, capacity: 128, outlineMax: 0.06 });
  M.clouds = [4, 6, 8].map((n) => new Mesh(r, cloud(rng, n), { capacity: 16, transparent: true, mode: 6, layer: 9 }));
  M.bird = new Mesh(r, bird().smooth(70), { capacity: 64, outlineMax: 0.06 });
  M.wing = new Mesh(r, wing(), { capacity: 128, cull: false });
  M.bfly = new Mesh(r, butterflyWing(), { capacity: 256, cull: false });
  M.petal = new Mesh(r, petal(), { capacity: 512, cull: false });
  M.duck = new Mesh(r, duck(rng).smooth(70), { capacity: 32, outlineMax: 0.08 });
  M.lily = new Mesh(r, lilypad(), { static: true, capacity: 128, outline: false });
  M.health = new Mesh(r, healthPack().smooth(50), { capacity: 32 });
  M.ammo = new Mesh(r, ammoPack().smooth(50), { capacity: 32 });
  M.wcrate = new Mesh(r, weaponCrate().smooth(50), { capacity: 32 });
  M.gem = new Mesh(r, gem(), { capacity: 32 });
  M.chute = new Mesh(r, parachute(), { capacity: 8, cull: false });
  M.rocket = new Mesh(r, rocketMesh().smooth(50), { capacity: 64, outlineMax: 0.05 });
  M.mine = new Mesh(r, mineMesh().smooth(50), { capacity: 64 });
  M.bomb = new Mesh(r, bombMesh().smooth(50), { capacity: 64 });
  M.nukeShell = new Mesh(r, nukeMesh().smooth(60), { capacity: 8 });
  M.jet = new Mesh(r, jetMesh().smooth(50), { capacity: 8 });
  // soft contact shadows under everything (no shadow maps)
  const blob = new Geo().blob();
  M.blobStatic = new Mesh(r, blob, { static: true, capacity: 2048, transparent: true, mode: 5, layer: 1 });
  M.blob = new Mesh(r, blob, { capacity: 1024, transparent: true, mode: 5, layer: 1 });

  const unitSphere = new Geo().sphere(0, 0, 0, 1, 1, [1, 1, 1, 1]);
  const lowSphere = new Geo().sphere(0, 0, 0, 1, 0, [1, 1, 1, 1]);
  const unitBox = new Geo().box(0, 0, 0, 1, 1, 1, [1, 1, 1, 1]);
  const zBox = new Geo().box(0, 0, 0.5, 1, 1, 1, [1, 1, 1, 1]);
  const softSphere = new Geo().sphere(0, 0, 0, 1, 2, [1, 1, 1, 1]).smooth(80);
  M.shell = new Mesh(r, new Geo().sphere(0, 0, 0, 1, 1, [0.25, 0.25, 0.3, 1], 0, rng, 1).smooth(80), { capacity: 64, outlineMax: 0.06 });
  M.chunk = new Mesh(r, unitBox, { capacity: 512, outlineMax: 0.05 });
  M.ball = new Mesh(r, new Geo().sphere(0, 0, 0, 1, 1, [1, 1, 1, 1]).smooth(80), { capacity: 256, outlineMax: 0.06 });
  M.puff = new Mesh(r, softSphere, { capacity: 1536, transparent: true, layer: 4, mode: 4 });
  M.fire = new Mesh(r, softSphere, { capacity: 1024, transparent: true, mode: 3, layer: 5 });
  M.glow = new Mesh(r, lowSphere, { capacity: 1024, transparent: true, additive: true, mode: 1, layer: 6 });
  M.spark = new Mesh(r, zBox, { capacity: 1024, transparent: true, additive: true, mode: 1, layer: 6 });
  M.beam = new Mesh(r, zBox, { capacity: 32, transparent: true, additive: true, mode: 1, layer: 7 });
  M.shock = new Mesh(r, new Geo().ring(0, 0, 0, 0.8, 1, 24, [1, 1, 1, 1]), { capacity: 64, transparent: true, additive: true, mode: 1, cull: false, layer: 6 });
  M.decal = new Mesh(r, blob, { capacity: 256, transparent: true, layer: 1, mode: 5 });
  M.track = new Mesh(r, new Geo().box(0, 0, 0, 1, 0.01, 1, [1, 1, 1, 1]), { capacity: 2048, transparent: true, layer: 1, mode: 1 });
  M.teamRing = new Mesh(r, new Geo().ring(0, 0, 0, 0.82, 1, 28, [1, 1, 1, 1]), { capacity: 16, transparent: true, layer: 2, mode: 1, cull: false });
  // ground-hugging rings for target areas: one annulus sector per instance, each tilted to follow the
  // terrain under it (Client.groundRing). The x-ray copy shows the parts hidden by hills and props, faintly.
  const sector = (r0, seg) => {
    const a = (Math.PI * 2) / seg, c = Math.cos(a), s = Math.sin(a);
    const g = new Geo();
    g.quad([r0, 0, 0], [1, 0, 0], [c, 0, s], [r0 * c, 0, r0 * s], [1, 1, 1, 1]);
    return g;
  };
  for (const [k, r0, seg] of [['aimRing', 0.82, 48], ['dangerRing', 0.965, 96]]) {
    M[k] = new Mesh(r, sector(r0, seg), { capacity: 256, transparent: true, layer: 2, mode: 1, cull: false, ground: true });
    M[k + 'X'] = new Mesh(r, sector(r0, seg), { capacity: 256, transparent: true, layer: 2, mode: 1, cull: false, xray: true });
    M[k].r0 = M[k + 'X'].r0 = r0; M[k].seg = M[k + 'X'].seg = seg;
  }
  M.bubble = new Mesh(r, unitSphere, { capacity: 8, transparent: true, additive: true, mode: 1, layer: 8, cull: false });
  // light beacon over pickups: bright at the base, fading to nothing at the top (additive)
  const cone = new Geo();
  for (let i = 0; i < 12; i++) {
    const a0 = (i / 12) * Math.PI * 2, a1 = ((i + 1) / 12) * Math.PI * 2;
    const b0 = [Math.cos(a0), 0, Math.sin(a0)], b1 = [Math.cos(a1), 0, Math.sin(a1)];
    const t0 = [Math.cos(a0) * 0.25, 1, Math.sin(a0) * 0.25], t1 = [Math.cos(a1) * 0.25, 1, Math.sin(a1) * 0.25];
    cone.triC(b0, t0, t1, [1, 1, 1, 1], [0, 0, 0, 1], [0, 0, 0, 1]);
    cone.triC(b0, t1, b1, [1, 1, 1, 1], [0, 0, 0, 1], [1, 1, 1, 1]);
  }
  M.beacon = new Mesh(r, cone, { capacity: 64, transparent: true, additive: true, mode: 1, cull: false, layer: 7 });
  M.dash = new Mesh(r, zBox, { capacity: 256, transparent: true, mode: 1, layer: 7 });
  return M;
}
