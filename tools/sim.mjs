#!/usr/bin/env node
// Headless balance harness: runs the authoritative Sim in Node with bots only and prints statistics.
// Usage: node tools/sim.mjs [--seconds 180] [--runs 3] [--seed 1] [--bot-tanks a,b,c,d] [--difficulty hard] [--skill 1-5] [--duel a,b]
import { Sim } from '../public/js/sim.js';
import { resolveConfig, toCamel } from '../public/js/config.js';

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[toCamel(process.argv[i].replace(/^--/, ''))] = process.argv[i + 1];
const seconds = +(args.seconds || 180), runs = +(args.runs || 3);
const out = [];
for (let r = 0; r < runs; r++) {
  const duel = args.duel ? args.duel.split(',') : null;
  const cfg = resolveConfig({ seed: (+(args.seed || 1)) + r, bots: duel ? 2 : 4, botTanks: duel ? args.duel : (args.botTanks || ''), difficulty: args.difficulty || 'normal', skill: args.skill ?? 5, scoreLimit: 0, timeLimit: 0, lobby: false, airdrop: args.airdrop ?? 35, pickups: args.pickups ?? 'true' });
  const sim = new Sim(cfg);
  sim.startMatch([]);
  const t0 = performance.now();
  const evc = {};
  for (let i = 0; i < seconds * 60; i++) { sim.step(); for (const e of sim.drainEvents()) evc[e.e] = (evc[e.e] || 0) + 1; }
  const ms = performance.now() - t0;
  out.push({ run: r, ms: Math.round(ms), stepMs: +(ms / (seconds * 60)).toFixed(3), events: evc, tanks: sim.tanks.map((t) => ({ type: t.def.id, k: t.kills, d: t.deaths, dmg: Math.round(t.stats.dmg), shots: t.stats.shots, hits: t.stats.hits, w: Object.fromEntries(Object.entries(t.stats.byWeapon).map(([k, v]) => [k, `${v.hits}/${v.shots} ${Math.round(v.dmg)}`])) })) });
}
console.log(JSON.stringify(out, null, 1));
