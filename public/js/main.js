// Browser entry: resolve config (CLI-injected defaults < URL params), start the game loop, expose test hooks.
import { resolveConfig } from './config.js';
import { Game } from './game.js';

const params = Object.fromEntries(new URLSearchParams(location.search));
const cfg = resolveConfig(window.MB_CONFIG || {}, params);

const canvas = document.getElementById('gl');
const hud = document.getElementById('hud');

let game;
try {
  game = new Game(canvas, hud, cfg);
} catch (e) {
  document.getElementById('err').textContent = 'Could not start: ' + e.message;
  throw e;
}
document.getElementById('loading')?.remove();

let errors = 0;
function loop(t) {
  requestAnimationFrame(loop);
  try {
    game.frame(t);
  } catch (e) {
    // keep running; surface the first few errors for debugging
    if (errors++ < 5) console.error(e && e.stack ? e.stack : e);
  }
}
requestAnimationFrame(loop);

// Test / debug hooks (used by the screenshot tooling).
window.MB = {
  game,
  cfg,
  /** Scripted controls for a local player slot: {throttle, turn, turretRate, pitchRate, fire, zoom, cycle} */
  setInput(slot, state) { game.input.virtual[slot] = { ...game.input.virtual[slot], ...state }; },
  clearInput(slot) { game.input.virtual[slot] = {}; },
  press(code) { game.input.virtualPress.add(code); game.input.pressed.add(code); },
  start() { if (game.state === 'lobby') game.startMatch(); game.countdown = 0.51; },
  /** Advance the simulation quickly (seconds of game time) without rendering. */
  simulate(seconds) { const n = Math.round(seconds * 60); for (let i = 0; i < n; i++) game.step(1 / 60); },
  snapshot() {
    return {
      state: game.state, time: +game.time.toFixed(2), matchTime: +game.matchTime.toFixed(2), fps: Math.round(game.fps),
      tanks: game.tanks.map((t) => ({
        name: t.name, type: t.def.id, human: t.human, alive: t.alive, hp: Math.round(t.hp), maxHp: t.maxHp,
        x: +t.x.toFixed(1), z: +t.z.toFixed(1), yaw: +t.yaw.toFixed(3), turretYaw: +t.turretYaw.toFixed(3), aimYaw: +t.aimYaw.toFixed(3), pitch: +t.pitch.toFixed(3),
        speed: +t.speed.toFixed(2), score: t.score, kills: t.kills, deaths: t.deaths, weapon: t.weapons[t.wi].id,
        weapons: t.weapons.map((w) => `${w.id}:${w.ammo}`).join(','), power: Object.entries(t.power).filter(([, v]) => v > 0).map(([k, v]) => `${k}:${v.toFixed(1)}`).join(','),
        stats: t.stats, respawnT: +t.respawnT.toFixed(2),
      })),
      projectiles: game.projectiles.length, mines: game.mines.length, particles: game.fx.parts.length,
      pickupsActive: game.pickups.filter((p) => p.active).length, pickupsTotal: game.pickups.length, drops: game.drops.length,
      obstaclesAlive: game.world.obstacles.filter((o) => o.alive).length, killfeed: game.killfeed.map((k) => `${k.a} -> ${k.b} (${k.w})`),
    };
  },
};
