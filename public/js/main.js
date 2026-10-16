// Browser entry: connect to the game server and run the client loop. Exposes test hooks on window.MB.
import { Client } from './client.js';

const params = Object.fromEntries(new URLSearchParams(location.search));
const canvas = document.getElementById('gl');
const hud = document.getElementById('hud');

let client;
try {
  client = new Client(canvas, hud, {
    name: params.name,
    type: params.tank,
    view: params.view,
    debug: params.debug === '1',
    mute: params.mute === '1',
    music: params.music !== '0',
  });
} catch (e) {
  document.getElementById('err').textContent = 'Could not start: ' + e.message;
  throw e;
}

let errors = 0;
function loop(t) {
  requestAnimationFrame(loop);
  try { client.frame(t); } catch (e) { if (errors++ < 5) console.error(e && e.stack ? e.stack : e); }
}
requestAnimationFrame(loop);

// Test / debug hooks (used by the headless screenshot tooling).
window.MB = {
  client,
  /** Scripted controls: {throttle, turn, turret, elev, fire, zoom} plus one-shots {prev, next, view, smoke, pick}. */
  setInput(state) { Object.assign(client.input.virtual, state); },
  clearInput() { client.input.virtual = {}; },
  press(code) { client.input.pressed.add(code); },
  start() { client.net.send({ t: 'start' }); },
  snapshot() {
    const c = client;
    return {
      status: c.status, state: c.state, you: c.you, view: c.view, weapon: c.weapon,
      aim: { yaw: +c.aim.yaw.toFixed(3), pitch: +c.aim.pitch.toFixed(3), range: Math.round(c.aim.range) }, pred: { yaw: +c.pred.yaw.toFixed(3) },
      lock: c.lock, fps: Math.round(c.fps || 0), particles: c.fx ? c.fx.parts.length : 0, proj: c.proj.size,
      tanks: [...c.tanks.values()].map((t) => ({ id: t.id, name: t.net.name, type: t.type, human: !!t.net.h, alive: !!t.net.al, hp: t.net.hp, x: +t.x.toFixed(1), z: +t.z.toFixed(1), yaw: t.net.yaw, ty: t.net.ty, p: t.net.p, spd: t.net.spd, w: t.net.w, wi: t.net.wi, k: t.net.k, d: t.net.d, heat: t.net.heat, sm: t.net.sm, scd: t.net.scd })),
      strikes: c.strikes.length, smokes: c.smokes.length, pickups: c.pickups.filter((p) => p.active).length,
    };
  },
};
