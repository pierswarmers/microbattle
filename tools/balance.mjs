#!/usr/bin/env node
// Balance harness: runs the authoritative Sim headless and measures every weapon and vehicle.
//   node tools/balance.mjs [weapons|duels|strike|flame|all] [--runs N]
import { Sim, DT } from '../public/js/sim.js';
import { resolveConfig } from '../public/js/config.js';
import { WEAPONS, TANK_ORDER, TANK_TYPES } from '../public/js/defs.js';
import { World } from '../public/js/world.js';
import { NULL_MODELS } from '../public/js/sim.js';
import { makeRng } from '../public/js/math.js';
const rnd = makeRng(4242);

const what = process.argv[2] || 'all';
const ri = process.argv.indexOf('--runs');
const runs = ri > 0 ? +process.argv[ri + 1] || 6 : 6;
const cfgBase = { seed: 11, scoreLimit: 0, timeLimit: 0, lobby: false, pickups: false, airdrop: 0, difficulty: 'hard', respawn: 3.5 };
const world = new World(null, NULL_MODELS, resolveConfig(cfgBase)); // shared terrain, rebuilt obstacles per sim

function flatSpot(sim, need = 140) {
  // a fairly open, flat stretch of map for controlled tests
  const W = sim.world;
  let best = null, bs = 1e9;
  for (let i = 0; i < 400; i++) {
    const x = (rnd() - 0.5) * W.size * 0.6, z = (rnd() - 0.5) * W.size * 0.6;
    let s = 0, ok = true;
    for (let d = 0; d <= need; d += 10) {
      const px = x + d, h = W.heightAt(px, z);
      if (W.isWater(px, z) || !W.inBounds(px, z, 5)) { ok = false; break; }
      s += Math.abs(h - W.heightAt(x, z));
      W.query(px, z, 3, () => { s += 5; });
    }
    if (ok && W.segmentBlocked(x, W.heightAt(x, z) + 2, z, x + need - 20, W.heightAt(x + need - 20, z) + 1.5, z)) ok = false;
    if (ok && s < bs) { bs = s; best = [x, z]; }
  }
  return best;
}

function newSim(types, seed = cfgBase.seed) {
  const sim = new Sim(resolveConfig({ ...cfgBase, seed, bots: types.length, botTanks: types.join(',') }));
  sim.startMatch([]);
  sim.countdown = 0.5; sim.step(DT);
  return sim;
}

/** One weapon fired by a hard bot at a target dummy at `range`, for `secs`, unlimited ammo. */
function weaponTest(wid, range, moving, secs = 30) {
  const shooterType = Object.values(TANK_TYPES).find((d) => d.weapons.includes(wid))?.id || 'standard';
  const sim = newSim([shooterType, 'standard']);
  const [a, b] = sim.tanks;
  const [x, z] = flatSpot(sim, range + 20);
  a.x = x; a.z = z; b.x = x + range; b.z = z; a.yaw = Math.PI / 2; b.yaw = 0;
  if (!a.weapons.find((w) => w.id === wid)) a.weapons.push({ id: wid, ammo: 999 });
  for (const w of a.weapons) w.ammo = 999;
  b.maxHp = b.hp = 1e6; b.def = { ...b.def, armor: 1 };
  const bot = sim.bots.find((q) => q.t === a);
  sim.bots = [bot]; // target is a dummy we drive ourselves
  bot.chooseWeapon = () => wid;
  bot.chooseGoal = () => { bot.goal = null; };
  let t0 = sim.time;
  const n = secs / DT;
  for (let i = 0; i < n; i++) {
    a.x = x; a.z = z; a.speed = 0; a.kx = a.kz = 0; // shooter stays put
    if (moving) {
      // target circles at ~12 m/s around its spot
      const ang = (sim.time - t0) * 0.5;
      b.input.throttle = 0.75; b.input.turn = 0.55;
      if (Math.hypot(b.x - (x + range), b.z - z) > 18) { b.x = x + range + Math.cos(ang) * 10; b.z = z + Math.sin(ang) * 10; }
    } else { b.x = x + range; b.z = z; b.speed = 0; b.input.throttle = 0; b.kx = b.kz = 0; }
    b.burnT = 0; b.heat = 0; a.heat = Math.min(a.heat, 0.5); a.burnT = 0; a.hp = a.maxHp;
    sim.step(DT);
  }
  const s = a.stats.byWeapon[wid] || { shots: 0, hits: 0, dmg: 0 };
  return { dps: s.dmg / secs, shots: s.shots, hits: s.hits, dmg: s.dmg };
}

function report(title, rows) { console.log('\n' + title); console.table(rows); }

if (what === 'weapons' || what === 'all') {
  const rows = [];
  for (const wid of ['standard', 'highvel', 'seeker', 'massive', 'cluster', 'flame', 'rapid']) {
    const W = WEAPONS[wid];
    const ranges = wid === 'flame' ? [10] : wid === 'rapid' ? [25, 60] : [40, 90];
    for (const r of ranges) for (const mv of [false, true]) {
      let dps = 0, acc = 0, shots = 0;
      for (let k = 0; k < Math.max(6, runs); k++) { const q = weaponTest(wid, r, mv, wid === 'massive' ? 60 : 30); dps += q.dps; acc += q.shots ? q.hits / q.shots : 0; shots += q.shots; }
      const n = Math.max(6, runs);
      dps /= n; acc /= n;
      // damage a full magazine can deal at this hit rate (ammo is the long-term limiter)
      const perShot = dps * (W.reload) ;
      rows.push({ weapon: wid, range: r, target: mv ? 'moving' : 'still', dps: +dps.toFixed(1), hitRate: +(acc * 100).toFixed(0), shotsPerMin: Math.round((shots / n) * (60 / (wid === 'massive' ? 60 : 30))), ammo: W.start, magDmg: Math.round(perShot * W.start) });
    }
  }
  report('WEAPONS (hard bot, unlimited ammo; magDmg = damage from the starting ammo at this hit rate)', rows);
}

if (what === 'duels' || what === 'all') {
  const rows = [];
  for (let i = 0; i < TANK_ORDER.length; i++) for (let j = i + 1; j < TANK_ORDER.length; j++) {
    const A = TANK_ORDER[i], B = TANK_ORDER[j];
    let ka = 0, kb = 0, da = 0, db = 0;
    for (let r = 0; r < runs; r++) {
      const sim = new Sim(resolveConfig({ ...cfgBase, seed: 100 + r, bots: 2, botTanks: `${A},${B}`, pickups: true, airdrop: 0 }));
      sim.startMatch([]);
      for (let k = 0; k < 150 / DT; k++) sim.step(DT);
      ka += sim.tanks[0].kills; kb += sim.tanks[1].kills; da += sim.tanks[0].stats.dmg; db += sim.tanks[1].stats.dmg;
    }
    rows.push({ duel: `${A} v ${B}`, kills: `${ka} : ${kb}`, dmg: `${Math.round(da / runs)} : ${Math.round(db / runs)}`, edge: +((ka - kb) / Math.max(1, ka + kb)).toFixed(2) });
  }
  report(`DUELS (${runs} × 150 s, hard bots, pickups on; edge = (kA-kB)/(kA+kB))`, rows);
}

if (what === 'strike' || what === 'all') {
  const rows = [];
  for (const type of TANK_ORDER) {
    let survived = 0, dmg = 0, dist = 0;
    for (let r = 0; r < runs; r++) {
      const sim = newSim([type, 'scout']);
      sim.bots = [];
      const [a, b] = sim.tanks;
      const [x, z] = flatSpot(sim, 80);
      a.x = x; a.z = z; a.yaw = Math.PI / 2; a.speed = 0; // facing out of the zone (+x)
      b.x = x - 150; b.z = z;
      sim.strikes.push({ id: 999, x, z, r: WEAPONS.strike.radius, t: WEAPONS.strike.delay, owner: b, run: false });
      const hp0 = a.hp;
      let d = 0;
      for (let k = 0; k < 8 / DT; k++) {
        a.input.throttle = 1; a.input.turn = 0; sim.step(DT);
        if (!d && k * DT >= WEAPONS.strike.delay) d = Math.hypot(a.x - x, a.z - z); // bombs start landing
      }
      dist += d;
      if (a.alive) survived++;
      dmg += hp0 - Math.max(0, a.hp);
    }
    rows.push({ vehicle: type, escaped: `${survived}/${runs}`, avgDamage: Math.round(dmg / runs), distAtImpact: Math.round(dist / runs), zone: WEAPONS.strike.radius });
  }
  // and a tank that just sits in the middle
  let dead = 0, dm = 0;
  for (let r = 0; r < runs; r++) {
    const sim = newSim(['standard', 'scout']); sim.bots = [];
    const [a, b] = sim.tanks; const [x, z] = flatSpot(sim, 40);
    a.x = x; a.z = z; b.x = x - 150;
    sim.strikes.push({ id: 999, x, z, r: WEAPONS.strike.radius, t: WEAPONS.strike.delay, owner: b, run: false });
    for (let k = 0; k < 8 / DT; k++) { a.input.throttle = 0; sim.step(DT); }
    if (!a.alive) dead++; dm += 125 - Math.max(0, a.hp);
  }
  rows.push({ vehicle: 'standard (stays at centre)', escaped: `${runs - dead}/${runs}`, avgDamage: Math.round(dm / runs) });
  report('AIR STRIKE: start at the centre of the zone, drive straight out when it is marked', rows);
}

if (what === 'flame' || what === 'all') {
  let total = 0, n = 0;
  for (let r = 0; r < 60; r++) {
    const sim = newSim(['scout', 'standard'], 500 + r); sim.bots = [];
    const a = sim.tanks[0];
    a.wi = a.weapons.findIndex((w) => w.id === 'flame');
    a.weapons[a.wi].ammo = 9999;
    let t = 0;
    while (t < 60 && a.burnT <= 0) { a.input.fire = true; a.input.weapon = 'flame'; sim.step(DT); t += DT; }
    total += t; n++;
  }
  console.log(`\nFLAMER: average continuous firing before the fuel catches fire: ${(total / n).toFixed(1)} s (ammo lasts ${(WEAPONS.flame.start * WEAPONS.flame.reload).toFixed(1)} s)`);
}
