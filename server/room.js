// A game room: runs the authoritative Sim at 60 Hz, manages the lobby and seats, applies player
// inputs and broadcasts snapshots (+ the events that happened since the last one) at 30 Hz.
import { Sim, DT } from '../public/js/sim.js';
import { TANK_ORDER } from '../public/js/defs.js';

const SNAP_EVERY = 2; // steps per snapshot (60 Hz sim -> 30 Hz network)
let nextClientId = 1;

export class Room {
  constructor(cfg, log = console.log) {
    this.cfg = cfg;
    this.log = log;
    this.clients = new Map();
    this.sim = new Sim(cfg);
    this.lobbyT = cfg.lobbyTimeout;
    this.overT = 0;
    this.stepN = 0;
    this.pending = [];
    if (!cfg.lobby) this.start();
    let last = performance.now(), acc = 0;
    this.timer = setInterval(() => {
      const now = performance.now();
      acc += Math.min(0.25, (now - last) / 1000);
      last = now;
      while (acc >= DT) { this.tick(); acc -= DT; }
    }, 4);
  }

  /** Seats 0-3; humans take a free seat, bots fill the rest when the match starts. */
  freeSeat() {
    const taken = new Set([...this.clients.values()].filter((c) => c.slot >= 0).map((c) => c.slot));
    return [0, 1, 2, 3].find((s) => !taken.has(s)) ?? -1;
  }

  join(ws) {
    const c = { id: nextClientId++, ws, slot: this.freeSeat(), name: 'Player', type: TANK_ORDER[1], ready: false, view: null };
    this.clients.set(c.id, c);
    ws.on('message', (m) => { try { this.onMessage(c, JSON.parse(m)); } catch (e) { this.log('bad message', e.message); } });
    ws.on('close', () => this.leave(c));
    if (c.slot < 0) this.log(`client ${c.id} connected as spectator (room full)`);
  }

  leave(c) {
    this.clients.delete(c.id);
    this.log(`${c.name} left (seat ${c.slot + 1})`);
    if (c.slot >= 0 && this.sim.state !== 'lobby') this.sim.humanLeave(c.slot);
    this.broadcastLobby();
  }

  onMessage(c, m) {
    switch (m.t) {
      case 'hello':
        c.name = String(m.name || 'Player').replace(/[^\w \-!?.]/g, '').slice(0, 14) || 'Player';
        if (TANK_ORDER.includes(m.type)) c.type = m.type;
        this.log(`${c.name} joined${c.slot >= 0 ? ` (seat ${c.slot + 1})` : ' as spectator'}`);
        this.send(c, { t: 'welcome', you: c.slot, cfg: this.publicCfg(), dead: this.sim.world.obstacles.filter((o) => !o.alive).map((o) => o.index) });
        if (c.slot >= 0 && this.sim.state !== 'lobby') this.sim.humanJoin(c.slot, c.name, c.type);
        this.broadcastLobby();
        this.maybeAutoStart();
        break;
      case 'lobby':
        if (TANK_ORDER.includes(m.type)) {
          c.type = m.type;
          const t = this.sim.tankById(c.slot);
          if (t && t.human) { if (t.alive) t.nextType = m.type; else this.sim.setType(t, m.type); }
        }
        if (typeof m.ready === 'boolean') c.ready = m.ready;
        this.broadcastLobby();
        this.maybeAutoStart();
        break;
      case 'start':
        if (this.sim.state === 'lobby') this.start();
        else if (this.sim.state === 'over' && this.overT > 2) this.restart();
        break;
      case 'in': {
        if (c.slot < 0) return;
        const t = this.sim.tankById(c.slot);
        if (!t || !t.human) return;
        const I = t.input;
        I.throttle = clampN(m.th, -1, 1); I.turn = clampN(m.tu, -1, 1);
        I.aimYaw = num(m.ay); I.aimPitch = num(m.ap); I.aimDist = clampN(m.ad, 0, 400);
        I.fire = !!m.f; I.weapon = typeof m.w === 'string' ? m.w : null; I.lock = Number.isInteger(m.lk) ? m.lk : -1;
        if (Number.isInteger(m.sm) && m.sm > I.smoke) I.smoke = m.sm;
        break;
      }
      case 'ping':
        this.send(c, { t: 'pong', c: m.c });
        break;
    }
  }

  publicCfg() {
    const { mode, mapSize, seed, trees, scoreLimit, timeLimit, lives, pickups, powerups, zoom, quality, difficulty, lobby, players } = this.cfg;
    return { mode, mapSize, seed, trees, scoreLimit, timeLimit, lives, pickups, powerups, zoom, quality, difficulty, lobby, players };
  }

  humans() { return [...this.clients.values()].filter((c) => c.slot >= 0); }

  maybeAutoStart() {
    if (this.sim.state !== 'lobby') return;
    const hs = this.humans();
    if (this.cfg.players > 0 && hs.length >= this.cfg.players) this.start();
    else if (hs.length > 0 && hs.every((c) => c.ready)) this.start();
  }

  start() {
    const entries = this.humans().map((c) => ({ slot: c.slot, human: true, type: c.type, name: c.name }));
    this.sim.startMatch(entries);
    this.overT = 0;
    this.log(`match started: ${entries.length} player(s) + ${this.sim.tanks.length - entries.length} bot(s)`);
    this.broadcastLobby();
  }

  restart() {
    this.sim.restart();
    this.start();
  }

  tick() {
    const sim = this.sim;
    if (sim.state === 'lobby' && this.cfg.lobbyTimeout > 0 && this.humans().length) {
      this.lobbyT -= DT;
      if (this.lobbyT <= 0) this.start();
    }
    sim.step(DT);
    if (sim.state === 'over') { this.overT += DT; if (this.overT > 12) this.restart(); }
    this.stepN++;
    if (this.stepN % SNAP_EVERY === 0) this.broadcastSnapshot();
  }

  broadcastSnapshot() {
    const snap = this.sim.snapshot();
    snap.t = 'snap';
    snap.ev = this.sim.drainEvents();
    snap.lt = this.cfg.lobbyTimeout > 0 && this.sim.state === 'lobby' ? Math.max(0, Math.round(this.lobbyT)) : -1;
    const msg = JSON.stringify(snap);
    for (const c of this.clients.values()) c.ws.send(msg);
  }

  broadcastLobby() {
    const msg = JSON.stringify({ t: 'lobby', state: this.sim.state, players: [...this.clients.values()].map((c) => ({ id: c.id, slot: c.slot, name: c.name, type: c.type, ready: c.ready })) });
    for (const c of this.clients.values()) c.ws.send(msg);
  }

  send(c, m) { c.ws.send(JSON.stringify(m)); }
}

function num(v) { return Number.isFinite(v) ? v : 0; }
function clampN(v, a, b) { return Math.max(a, Math.min(b, num(v))); }
