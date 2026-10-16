// All the toy-like meshes used by the game.
import { Geo, T } from './geo.js';
import { Mesh } from './gl.js';

const PAINT = [0.95, 0.95, 0.95, 1];
const PAINT2 = [0.72, 0.72, 0.72, 1];
const PAINT3 = [0.55, 0.55, 0.55, 1];
const TRACK = [0.16, 0.16, 0.19, 0];
const WHEEL = [0.36, 0.36, 0.4, 0];
const HUB = [0.85, 0.75, 0.3, 0];
const METAL = [0.28, 0.29, 0.32, 0];
const LIGHT = [1, 0.95, 0.6, 0];

export { TANK_GEOM } from './defs.js';

function tracks(g, w, len, h, y = 0) {
  for (const sx of [-1, 1]) {
    const x = sx * (w / 2);
    g.box(x, y + h / 2, 0, 0.62, h, len, TRACK, 0.05);
    g.box(x, y + h * 0.15, 0, 0.66, h * 0.3, len * 0.93, TRACK);
    const n = Math.max(3, Math.round(len / 0.85));
    for (let i = 0; i < n; i++) {
      const z = -len / 2 + 0.45 + (i * (len - 0.9)) / (n - 1);
      g.cyl(x + (sx > 0 ? 0.31 : -0.37), y + h * 0.45, z, h * 0.36, h * 0.36, 0.06, 8, WHEEL, 'x');
      g.cyl(x + (sx > 0 ? 0.36 : -0.41), y + h * 0.45, z, h * 0.14, h * 0.14, 0.05, 6, HUB, 'x');
    }
  }
}

function antenna(g, x, y, z, h) {
  g.cyl(x, y, z, 0.035, 0.02, h, 4, METAL);
  g.box(x + 0.22, y + h - 0.18, z, 0.42, 0.26, 0.03, [1, 1, 1, 1]);
}

function headlights(g, w, y, z) {
  for (const sx of [-1, 1]) g.cyl(sx * w, y, z, 0.13, 0.13, 0.08, 8, LIGHT, 'z');
}

function buildTank(type) {
  const hull = new Geo(), turret = new Geo(), barrel = new Geo();
  if (type === 'scout') {
    tracks(hull, 2.0, 3.0, 0.75);
    hull.hull(0, 0.95, 0, 1.9, 0.5, 3.1, 0.55, 0.3, PAINT, PAINT);
    hull.box(0, 1.22, -1.1, 1.3, 0.12, 0.5, PAINT2);
    headlights(hull, 0.6, 0.98, 1.56);
    turret.cyl(0, 0, 0, 0.75, 0.62, 0.42, 10, PAINT, 'y', PAINT);
    turret.sphere(0, 0.42, -0.1, 0.38, 1, PAINT2, 0, Math.random, 0.6);
    turret.box(0, 0.28, 0.45, 0.6, 0.3, 0.4, PAINT2);
    antenna(turret, -0.45, 0.4, -0.35, 1.3);
    for (const sx of [-0.14, 0.14]) {
      barrel.cyl(sx, 0, 0, 0.07, 0.07, 1.9, 6, METAL, 'z');
      barrel.cyl(sx, 0, 1.6, 0.1, 0.1, 0.3, 6, METAL, 'z');
    }
    barrel.box(0, 0, 0.2, 0.42, 0.22, 0.4, PAINT3);
  } else if (type === 'standard') {
    tracks(hull, 2.4, 3.7, 0.85);
    hull.hull(0, 1.1, 0, 2.3, 0.6, 3.8, 0.7, 0.35, PAINT, PAINT);
    hull.box(0, 1.15, 0, 3.0, 0.1, 3.4, PAINT2);
    headlights(hull, 0.8, 1.12, 1.92);
    hull.box(-0.8, 1.48, -1.4, 0.5, 0.25, 0.6, PAINT3);
    turret.box(0, 0.3, -0.05, 1.7, 0.6, 1.9, PAINT, 0.18);
    turret.cyl(0.4, 0.6, -0.3, 0.3, 0.26, 0.25, 8, PAINT2);
    turret.box(0, 0.32, 0.85, 0.7, 0.42, 0.3, PAINT2);
    antenna(turret, -0.6, 0.6, -0.7, 1.6);
    barrel.cyl(0, 0, 0, 0.15, 0.13, 2.7, 8, METAL, 'z');
    barrel.cyl(0, 0, 2.3, 0.2, 0.2, 0.4, 8, METAL, 'z');
    barrel.cyl(0, 0, 0, 0.28, 0.24, 0.5, 8, PAINT3, 'z');
  } else if (type === 'superheavy') {
    tracks(hull, 2.9, 4.2, 1.0);
    hull.hull(0, 1.3, 0, 2.7, 0.75, 4.3, 0.8, 0.4, PAINT, PAINT);
    for (const sx of [-1, 1]) hull.box(sx * 1.47, 0.95, 0, 0.12, 0.55, 3.9, PAINT2);
    // ram plow
    hull.box(0, 0.6, 2.35, 3.2, 0.7, 0.25, PAINT3, 0.1);
    for (let i = -3; i <= 3; i++) hull.box(i * 0.45, 0.6, 2.5, 0.12, 0.6, 0.15, METAL);
    headlights(hull, 1.0, 1.3, 2.17);
    turret.box(0, 0.38, -0.1, 2.3, 0.76, 2.5, PAINT, 0.2);
    turret.box(0, 0.4, -1.45, 1.6, 0.5, 0.5, PAINT2);
    turret.cyl(-0.55, 0.76, -0.4, 0.38, 0.32, 0.28, 8, PAINT2);
    turret.cyl(0.6, 0.76, -0.3, 0.24, 0.24, 0.2, 8, PAINT3);
    antenna(turret, 0.85, 0.76, -1.0, 1.8);
    barrel.cyl(0, 0, 0, 0.24, 0.2, 3.1, 8, METAL, 'z');
    barrel.box(0, 0, 3.0, 0.62, 0.32, 0.5, METAL);
    barrel.cyl(0, 0, 0, 0.42, 0.36, 0.7, 8, PAINT3, 'z');
  } else if (type === 'artillery') {
    tracks(hull, 2.6, 3.9, 0.85);
    hull.hull(0, 1.1, 0, 2.5, 0.6, 4.0, 0.5, 0.2, PAINT, PAINT);
    hull.box(0, 1.45, 1.3, 1.6, 0.2, 0.8, PAINT2);
    headlights(hull, 0.9, 1.1, 2.0);
    // stabiliser feet
    for (const sx of [-1, 1]) hull.box(sx * 1.45, 0.5, -1.7, 0.3, 0.3, 0.5, METAL);
    turret.cyl(0, 0, 0, 1.15, 1.05, 0.45, 10, PAINT, 'y', PAINT2);
    for (const sx of [-1, 1]) turret.box(sx * 0.62, 0.6, 0.1, 0.22, 0.8, 1.2, PAINT2, 0.1);
    turret.box(0, 0.5, -0.9, 1.2, 0.4, 0.35, PAINT3);
    antenna(turret, -0.7, 0.45, -0.8, 1.4);
    barrel.cyl(0, 0, -0.5, 0.42, 0.38, 2.5, 10, METAL, 'z');
    barrel.cyl(0, 0, 1.6, 0.48, 0.48, 0.35, 10, PAINT3, 'z');
    barrel.cyl(0, 0, -0.6, 0.5, 0.5, 0.5, 10, PAINT2, 'z');
  } else if (type === 'longshot') {
    tracks(hull, 2.2, 3.8, 0.75);
    hull.hull(0, 0.95, 0, 2.1, 0.45, 4.0, 1.0, 0.4, PAINT, PAINT);
    hull.box(0, 1.08, -1.4, 1.6, 0.25, 0.7, PAINT2, 0.2);
    headlights(hull, 0.7, 0.95, 1.85);
    turret.box(0, 0.22, -0.2, 1.3, 0.45, 1.7, PAINT, 0.25);
    turret.box(0.5, 0.5, -0.3, 0.3, 0.22, 0.9, METAL);
    turret.cyl(0.5, 0.5, 0.15, 0.13, 0.13, 0.12, 6, [0.3, 1, 1, 0], 'z');
    antenna(turret, -0.45, 0.45, -0.8, 1.5);
    barrel.cyl(0, 0, 0, 0.11, 0.09, 4.4, 8, METAL, 'z');
    for (let i = 0; i < 4; i++) barrel.cyl(0, 0, 0.9 + i * 0.75, 0.17, 0.17, 0.18, 8, [0.3, 1, 1, 0], 'z');
    barrel.cyl(0, 0, 4.2, 0.16, 0.16, 0.25, 8, METAL, 'z');
    barrel.cyl(0, 0, 0, 0.24, 0.22, 0.5, 8, PAINT3, 'z');
  }
  return { hull, turret, barrel };
}

function tree(kind, rng) {
  const g = new Geo();
  const trunkCol = [0.48, 0.32, 0.2, 0];
  if (kind === 'round') {
    g.cyl(0, 0, 0, 0.42, 0.3, 3.2, 7, trunkCol);
    const fc = (y) => [0.95 + y * 0.08, 0.95 + y * 0.08, 0.95 + y * 0.08, 1];
    g.sphere(0, 4.3, 0, 2.3, 1, fc, 0.12, rng);
    g.sphere(1.2, 3.6, 0.4, 1.5, 1, fc, 0.12, rng);
    g.sphere(-1.0, 3.8, -0.6, 1.6, 1, fc, 0.12, rng);
  } else if (kind === 'pine') {
    g.cyl(0, 0, 0, 0.35, 0.25, 2.0, 6, trunkCol);
    const c = [1, 1, 1, 1];
    g.cyl(0, 1.4, 0, 2.3, 0, 2.6, 8, c);
    g.cyl(0, 2.7, 0, 1.8, 0, 2.3, 8, c);
    g.cyl(0, 3.9, 0, 1.25, 0, 2.0, 8, c);
  } else if (kind === 'birch') {
    g.cyl(0, 0, 0, 0.28, 0.2, 4.2, 6, [0.92, 0.9, 0.85, 0]);
    for (let i = 0; i < 4; i++) g.box(0, 0.8 + i * 0.9, 0, 0.5, 0.08, 0.5, [0.2, 0.2, 0.2, 0]);
    const fc = (y) => [0.95 + y * 0.08, 0.95 + y * 0.08, 0.95 + y * 0.08, 1];
    g.sphere(0, 5.0, 0, 1.6, 1, fc, 0.15, rng, 1.4);
  }
  return g;
}

function bush(rng) {
  const g = new Geo();
  const c = (y) => [0.9 + y * 0.1, 0.9 + y * 0.1, 0.9 + y * 0.1, 1];
  g.sphere(0, 0.5, 0, 0.9, 1, c, 0.15, rng);
  g.sphere(0.7, 0.4, 0.2, 0.65, 1, c, 0.15, rng);
  g.sphere(-0.6, 0.38, -0.3, 0.7, 1, c, 0.15, rng);
  // little berries
  for (let i = 0; i < 5; i++) {
    const a = rng() * 6.28;
    g.sphere(Math.cos(a) * 0.85, 0.5 + rng() * 0.5, Math.sin(a) * 0.85, 0.1, 0, [1, 0.25, 0.3, 0]);
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

function flower(rng) {
  const g = new Geo();
  g.cyl(0, 0, 0, 0.04, 0.03, 0.7, 4, [0.3, 0.65, 0.25, 0]);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * 6.28;
    g.sphere(Math.cos(a) * 0.17, 0.72, Math.sin(a) * 0.17, 0.13, 0, [1, 1, 1, 1], 0, rng, 0.4);
  }
  g.sphere(0, 0.74, 0, 0.1, 0, [1, 0.85, 0.2, 0], 0, rng, 0.6);
  return g;
}

function grass(rng) {
  const g = new Geo();
  const n = 5;
  for (let i = 0; i < n; i++) {
    const a = rng() * 6.28, r = rng() * 0.25;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const h = 0.5 + rng() * 0.5;
    const yaw = rng() * 6.28;
    const dx = Math.cos(yaw) * 0.07, dz = Math.sin(yaw) * 0.07;
    const lean = (rng() - 0.5) * 0.3;
    const shade = 0.85 + rng() * 0.25;
    g.tri([x - dx, 0, z - dz], [x + dx, 0, z + dz], [x + lean, h, z + lean * 0.5], [shade, shade, shade, 1]);
  }
  return g;
}

function rock(rng) {
  const g = new Geo();
  g.sphere(0, 0.3, 0, 1, 1, (y) => [0.9 + y * 0.1, 0.9 + y * 0.1, 0.9 + y * 0.1, 1], 0.22, rng, 0.75);
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

function cloud(rng) {
  const g = new Geo();
  const c = (y) => [1, 1, 1, 0].map((v, i) => (i < 3 ? 0.92 + y * 0.08 : 0));
  g.sphere(0, 0, 0, 6, 1, c, 0.1, rng, 0.7);
  g.sphere(6, -1, 1, 4.5, 1, c, 0.1, rng, 0.7);
  g.sphere(-6, -1.2, -0.5, 4.8, 1, c, 0.1, rng, 0.7);
  g.sphere(2, 2.5, -1, 4.2, 1, c, 0.1, rng, 0.7);
  g.sphere(-3, 1.8, 2, 3.8, 1, c, 0.1, rng, 0.7);
  return g;
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
export function createModels(r, rng) {
  const M = {};
  M.tanks = {};
  for (const type of ['scout', 'standard', 'artillery', 'superheavy']) {
    const t = buildTank(type);
    M.tanks[type] = {
      hull: new Mesh(r, t.hull, { capacity: 8 }),
      turret: new Mesh(r, t.turret, { capacity: 8 }),
      barrel: new Mesh(r, t.barrel, { capacity: 8 }),
    };
  }
  M.terrain = null; // set by world
  // trees are re-submitted each frame so ones hiding a tank can be drawn see-through in birds-eye view
  const tr = tree('round', rng), tp = tree('pine', rng), tb = tree('birch', rng);
  M.treeRound = new Mesh(r, tr, { sway: 0.0035, capacity: 512 });
  M.treePine = new Mesh(r, tp, { sway: 0.0035, capacity: 512 });
  M.treeBirch = new Mesh(r, tb, { sway: 0.003, capacity: 256 });
  M.treeRoundG = new Mesh(r, tr, { sway: 0.0035, capacity: 32, transparent: true, castShadow: false, layer: 8 });
  M.treePineG = new Mesh(r, tp, { sway: 0.0035, capacity: 32, transparent: true, castShadow: false, layer: 8 });
  M.treeBirchG = new Mesh(r, tb, { sway: 0.003, capacity: 32, transparent: true, castShadow: false, layer: 8 });
  M.treeBackdrop = new Mesh(r, tp, { static: true, sway: 0.0035, capacity: 512 });
  M.bush = new Mesh(r, bush(rng), { capacity: 256 });
  M.rock = new Mesh(r, rock(rng), { static: true, capacity: 256 });
  M.mushroom = new Mesh(r, mushroom(rng), { static: true, capacity: 64 });
  M.flower = new Mesh(r, flower(rng), { static: true, sway: 0.25, castShadow: false, capacity: 2048 });
  M.grass = new Mesh(r, grass(rng), { static: true, sway: 0.32, castShadow: false, cull: false, capacity: 8192 });
  M.crate = new Mesh(r, crate(), { capacity: 64 });
  M.barrel = new Mesh(r, barrelMesh(), { capacity: 64 });
  M.hay = new Mesh(r, haybale(), { static: true, capacity: 64 });
  M.house = new Mesh(r, house(rng), { static: true, capacity: 8 });
  M.windmill = new Mesh(r, windmillTower(), { static: true, capacity: 4 });
  M.blades = new Mesh(r, windmillBlades(), { capacity: 4, cull: false });
  M.fence = new Mesh(r, fence(), { static: true, capacity: 128 });
  M.cloud = new Mesh(r, cloud(rng), { capacity: 32, castShadow: false, mode: 1 }); // flat cartoon clouds
  M.cloudGhost = new Mesh(r, cloud(rng), { capacity: 16, transparent: true, castShadow: false, layer: 9, mode: 1 });
  M.bird = new Mesh(r, bird(), { capacity: 64, castShadow: false });
  M.wing = new Mesh(r, wing(), { capacity: 128, cull: false, castShadow: false });
  M.bfly = new Mesh(r, butterflyWing(), { capacity: 128, cull: false, castShadow: false, mode: 1 });
  M.duck = new Mesh(r, duck(rng), { capacity: 32 });
  M.lily = new Mesh(r, lilypad(), { static: true, capacity: 64, castShadow: false });
  M.health = new Mesh(r, healthPack(), { capacity: 32 });
  M.ammo = new Mesh(r, ammoPack(), { capacity: 32 });
  M.wcrate = new Mesh(r, weaponCrate(), { capacity: 32 });
  M.gem = new Mesh(r, gem(), { capacity: 32 });
  M.chute = new Mesh(r, parachute(), { capacity: 8, cull: false });
  M.rocket = new Mesh(r, rocketMesh(), { capacity: 64 });
  M.mine = new Mesh(r, mineMesh(), { capacity: 64 });
  M.bomb = new Mesh(r, bombMesh(), { capacity: 64 });
  M.nukeShell = new Mesh(r, nukeMesh(), { capacity: 8 });
  M.jet = new Mesh(r, jetMesh(), { capacity: 8 });

  const unitSphere = new Geo().sphere(0, 0, 0, 1, 1, [1, 1, 1, 1]);
  const lowSphere = new Geo().sphere(0, 0, 0, 1, 0, [1, 1, 1, 1]);
  const unitBox = new Geo().box(0, 0, 0, 1, 1, 1, [1, 1, 1, 1]);
  const zBox = new Geo().box(0, 0, 0.5, 1, 1, 1, [1, 1, 1, 1]);
  M.shell = new Mesh(r, new Geo().sphere(0, 0, 0, 1, 1, [0.25, 0.25, 0.25, 1], 0, rng, 1), { capacity: 64 });
  M.chunk = new Mesh(r, unitBox, { capacity: 256 });
  M.puff = new Mesh(r, new Geo().sphere(0, 0, 0, 1, 2, [1, 1, 1, 1]), { capacity: 1536, transparent: true, castShadow: false, layer: 4, mode: 4 });
  const smoothSphere = new Geo().sphere(0, 0, 0, 1, 2, [1, 1, 1, 1]);
  M.fire = new Mesh(r, smoothSphere, { capacity: 1024, transparent: true, mode: 3, castShadow: false, layer: 5 });
  M.glow = new Mesh(r, lowSphere, { capacity: 1024, transparent: true, additive: true, mode: 1, castShadow: false, layer: 6 });
  M.spark = new Mesh(r, zBox, { capacity: 1024, transparent: true, additive: true, mode: 1, castShadow: false, layer: 6 });
  M.beam = new Mesh(r, zBox, { capacity: 32, transparent: true, additive: true, mode: 1, castShadow: false, layer: 7 });
  M.shock = new Mesh(r, new Geo().ring(0, 0, 0, 0.8, 1, 24, [1, 1, 1, 1]), { capacity: 64, transparent: true, additive: true, mode: 1, cull: false, castShadow: false, layer: 6 });
  M.decal = new Mesh(r, new Geo().ring(0, 0, 0, 0, 1, 12, [1, 1, 1, 1]), { capacity: 256, transparent: true, castShadow: false, layer: 1, mode: 1 });
  M.track = new Mesh(r, new Geo().box(0, 0, 0, 1, 0.01, 1, [1, 1, 1, 1]), { capacity: 2048, transparent: true, castShadow: false, layer: 1, mode: 1 });
  M.teamRing = new Mesh(r, new Geo().ring(0, 0, 0, 0.82, 1, 28, [1, 1, 1, 1]), { capacity: 16, transparent: true, castShadow: false, layer: 2, mode: 1, cull: false });
  M.bubble = new Mesh(r, unitSphere, { capacity: 8, transparent: true, additive: true, mode: 1, castShadow: false, layer: 8, cull: false });
  // light beacon over pickups: bright at the base, fading to nothing at the top (additive)
  const cone = new Geo();
  for (let i = 0; i < 12; i++) {
    const a0 = (i / 12) * Math.PI * 2, a1 = ((i + 1) / 12) * Math.PI * 2;
    const b0 = [Math.cos(a0), 0, Math.sin(a0)], b1 = [Math.cos(a1), 0, Math.sin(a1)];
    const t0 = [Math.cos(a0) * 0.25, 1, Math.sin(a0) * 0.25], t1 = [Math.cos(a1) * 0.25, 1, Math.sin(a1) * 0.25];
    cone.triC(b0, t0, t1, [1, 1, 1, 1], [0, 0, 0, 1], [0, 0, 0, 1]);
    cone.triC(b0, t1, b1, [1, 1, 1, 1], [0, 0, 0, 1], [1, 1, 1, 1]);
  }
  M.beacon = new Mesh(r, cone, { capacity: 64, transparent: true, additive: true, mode: 1, cull: false, castShadow: false, layer: 7 });
  M.dash = new Mesh(r, zBox, { capacity: 256, transparent: true, mode: 1, castShadow: false, layer: 7 });
  return M;
}
