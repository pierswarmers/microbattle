// Game options. Shared by the browser (main.js) and the CLI launcher (microbattle.js).
import { TANK_ORDER } from './defs.js';

/** name: [default, type, description, allowed values] */
export const OPTIONS = {
  mode: ['any', 'enum', "Camera: birdseye (high overview), commander (gunner's sight), chase (behind the turret), or any (players switch with C)", ['any', 'birdseye', 'commander', 'chase']],
  players: [0, 'int', 'Start automatically once this many players have joined (0 = wait for someone to press Start)'],
  bots: ['auto', 'intOrAuto', "Bot count, or 'auto' to fill up to 4 tanks"],
  botTanks: ['', 'list', 'Tank types for bots, comma separated (random if empty)'],
  difficulty: ['normal', 'enum', 'Bot skill', ['easy', 'normal', 'hard']],
  mapSize: [360, 'int', 'Map edge length in metres (200-700)'],
  seed: [0, 'int', 'Map seed (0 = random)'],
  trees: [1, 'float', 'Scenery density multiplier (0-2)'],
  scoreLimit: [10, 'int', 'Kills needed to win (0 = off)'],
  timeLimit: [300, 'int', 'Match length in seconds (0 = unlimited)'],
  lives: [0, 'int', 'Lives per tank; >0 enables last-tank-standing'],
  respawn: [3.5, 'float', 'Respawn delay in seconds'],
  pickups: [true, 'bool', 'Health / ammo / weapon / power-up pickups'],
  powerups: [true, 'bool', 'Power-ups (turbo, shield, double damage, rapid fire, ghost)'],
  airdrop: [35, 'int', 'Seconds between parachute supply drops (0 = off)'],
  lobby: [true, 'bool', 'Show the join lobby before the match'],
  lobbyTimeout: [0, 'int', 'Auto-start the lobby after N seconds (0 = wait)'],
  zoom: [120, 'int', 'Birds-eye camera height (bigger = wider view of the battlefield)'],
  stabilizer: [true, 'bool', 'Turret keeps its world aim while the hull turns'],
  mouse: [true, 'bool', 'Allow aiming with the mouse'],
  quality: ['medium', 'enum', 'Graphics quality', ['low', 'medium', 'high']],
  season: ['summer', 'enum', 'Season: retints the island (spring blossom, summer apples, autumn leaves, winter snow)', ['spring', 'summer', 'autumn', 'winter', 'random']],
  volume: [0.7, 'float', 'Master volume 0-1'],
  music: [true, 'bool', 'Background music'],
  mute: [false, 'bool', 'Start muted'],
  fps: [false, 'bool', 'Show FPS counter'],
  debug: [false, 'bool', 'Testing: players spawn with every weapon fully stocked'],
};

export function parseValue(name, raw) {
  const [def, type, , allowed] = OPTIONS[name];
  if (raw === undefined || raw === null) return def;
  const s = String(raw).trim();
  switch (type) {
    case 'int': { const v = parseInt(s, 10); return Number.isFinite(v) ? v : def; }
    case 'float': { const v = parseFloat(s); return Number.isFinite(v) ? v : def; }
    case 'bool': return !['0', 'false', 'off', 'no'].includes(s.toLowerCase());
    case 'intOrAuto': { if (s === 'auto') return 'auto'; const v = parseInt(s, 10); return Number.isFinite(v) ? v : def; }
    case 'list': return s;
    case 'enum': { const v = s.toLowerCase(); return allowed.includes(v) ? v : def; }
  }
  return def;
}

/** Merge sources (later wins) and normalise. */
export function resolveConfig(...sources) {
  const out = {};
  for (const k of Object.keys(OPTIONS)) out[k] = OPTIONS[k][0];
  for (const src of sources) {
    if (!src) continue;
    for (const [k, v] of Object.entries(src)) {
      const key = toCamel(k);
      if (key in OPTIONS) out[key] = parseValue(key, v);
    }
  }
  const clampI = (v, a, b) => Math.max(a, Math.min(b, v));
  out.players = clampI(out.players, 0, 4);
  if (out.bots !== 'auto') out.bots = clampI(out.bots, 0, 4);
  out.mapSize = clampI(out.mapSize, 200, 700);
  out.trees = Math.max(0, Math.min(2, out.trees));
  out.volume = Math.max(0, Math.min(1, out.volume));
  if (out.season === 'random') out.season = ['spring', 'summer', 'autumn', 'winter'][Math.floor(Math.random() * 4)];
  if (!out.seed) out.seed = Math.floor(Math.random() * 1e6) + 1;
  const list = (s) => String(s || '').split(',').map((x) => x.trim().toLowerCase()).filter((x) => TANK_ORDER.includes(x));
  out.tanks = list(out.tanks);
  out.botTanks = list(out.botTanks);
  return out;
}

export function toCamel(k) { return k.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }
export function toKebab(k) { return k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()); }
