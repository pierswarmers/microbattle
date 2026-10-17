#!/usr/bin/env node
// Supply-drop reachability check: spawns many airdrops across seeds and verifies each landed box can be
// driven onto (no obstacle/water keeps a tank outside the pickup radius) and collected by every tank type
// on its spawn loadout. Usage: node tools/drops.mjs [--seeds 20] [--drops 40]
import { Sim } from '../public/js/sim.js';
import { resolveConfig, toCamel } from '../public/js/config.js';
import { TANK_ORDER } from '../public/js/defs.js';

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[toCamel(process.argv[i].replace(/^--/, ''))] = process.argv[i + 1];
const seeds = +(args.seeds || 20), perSeed = +(args.drops || 40);
let total = 0, blocked = 0;
const refused = {};
for (let seed = 1; seed <= seeds; seed++) {
  const cfg = resolveConfig({ seed, bots: TANK_ORDER.length, botTanks: TANK_ORDER.join(','), scoreLimit: 0, timeLimit: 0, lobby: false, airdrop: 35, pickups: 'true' });
  const sim = new Sim(cfg);
  sim.startMatch([]);
  const W = sim.world;
  for (let k = 0; k < perSeed; k++) {
    sim.drops = [];
    sim.spawnAirdrop();
    const d = sim.drops[0];
    if (!d) continue;
    total++;
    // geometric: park each tank type on the box, let obstacle push-out settle, still inside pickup radius?
    for (const t of sim.tanks) {
      let x = d.x, z = d.z;
      for (let it = 0; it < 8; it++) W.query(x, z, t.radius, (o) => {
        if (o.soft) return;
        const dx = x - o.x, dz = z - o.z, dd = Math.hypot(dx, dz) || 0.01, pen = t.radius + o.r - dd;
        if (pen > 0) { x += (dx / dd) * pen; z += (dz / dd) * pen; }
      });
      if (W.isWater(x, z) || Math.hypot(x - d.x, z - d.z) > t.radius + 1.6) { blocked++; break; }
    }
    // collectable on a fresh spawn loadout?
    for (const t of sim.tanks) {
      const saved = t.weapons.map((w) => ({ ...w })), savedPow = { ...t.power };
      const p = { x: d.x, z: d.z, y: d.gy, active: true, kind: d.kind, sub: d.sub, temp: 40 };
      if (!sim.collect(t, p)) { const key = `${t.def.id}:${d.kind}/${d.sub}`; refused[key] = (refused[key] || 0) + 1; }
      t.weapons = saved; t.power = savedPow;
    }
  }
}
const nRef = Object.values(refused).reduce((a, b) => a + b, 0);
console.log(JSON.stringify({ drops: total, physicallyBlocked: blocked, refusedByTank: nRef, refused }, null, 1));
process.exit(blocked || nRef ? 1 : 0);
