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
    this.reserved = new Map(); // name -> {slot, t} for players who just dropped
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

  /** Seats 0-3. Prefer a seat with no tank at all, then one a bot is driving. */
  freeSeat() {
    const taken = new Set([...this.clients.values()].filter((c) => c.slot >= 0).map((c) => c.slot));
    // keep recently vacated seats free for their owners if anything else is available
    const held = new Set([...this.reserved.values()].filter((r) => Date.now() - r.t < 60000).map((r) => r.slot));
    let free = [0, 1, 2, 3].filter((s) => !taken.has(s) && !held.has(s));
    if (!free.length) free = [0, 1, 2, 3].filter((s) => !taken.has(s));
    return free.find((s) => !this.sim.tankById(s)) ?? free[0] ?? -1;
  }

  join(ws) {
    // no seat until the client says hello; silent sockets are dropped
    const c = { id: nextClientId++, ws, slot: -1, hello: false, name: 'Player', type: TANK_ORDER[1], ready: false };
    this.clients.set(c.id, c);
    ws.on('message', (m) => { try { this.onMessage(c, JSON.parse(m)); } catch (e) { this.log('bad message', e.message); } });
    ws.on('close', () => this.leave(c));
    setTimeout(() => { if (!c.hello && this.clients.has(c.id)) ws.close(1008); }, 5000);
  }

  seat(c) {
    if (c.slot >= 0) return;
    // a player who drops and reconnects within a minute gets their own seat (and tank) back
    const r = this.reserved.get(c.name);
    const taken = new Set([...this.clients.values()].filter((q) => q.slot >= 0).map((q) => q.slot));
    if (r && Date.now() - r.t < 60000 && !taken.has(r.slot)) { c.slot = r.slot; this.reserved.delete(c.name); }
    else c.slot = this.freeSeat();
    if (c.slot >= 0 && this.sim.state !== 'lobby') this.sim.humanJoin(c.slot, c.name, c.type);
  }

  leave(c) {
    this.clients.delete(c.id);
    if (!c.hello) return;
    this.log(`${c.name} left${c.slot >= 0 ? ` (seat ${c.slot + 1})` : ' (spectator)'}`);
    if (c.slot >= 0) {
      this.reserved.set(c.name, { slot: c.slot, t: Date.now() });
      if (this.sim.state !== 'lobby') this.sim.humanLeave(c.slot);
      // promote the longest-waiting spectator into the freed seat
      const next = [...this.clients.values()].find((q) => q.hello && q.slot < 0);
      if (next) { this.seat(next); this.send(next, { t: 'welcome', you: next.slot, cfg: this.publicCfg(), dead: this.deadList(), apples: this.appleList() }); this.log(`${next.name} moved from spectator to seat ${next.slot + 1}`); }
    }
    this.broadcastLobby();
  }

  appleList() { return this.sim.world.obstacles.filter((o) => o.apples0 && o.apples < o.apples0).map((o) => [o.index, o.apples]); }
  deadList() { return this.sim.world.obstacles.filter((o) => !o.alive).map((o) => o.index); }

  onMessage(c, m) {
    switch (m.t) {
      case 'hello':
        c.name = String(m.name || 'Player').replace(/[^\w \-!?.]/g, '').slice(0, 14) || 'Player';
        if (TANK_ORDER.includes(m.type)) c.type = m.type;
        if (!c.hello) {
          c.hello = true;
          this.seat(c);
          this.log(`${c.name} joined${c.slot >= 0 ? ` (seat ${c.slot + 1})` : ' as spectator (room full)'}`);
        } else if (c.slot >= 0) { const t = this.sim.tankById(c.slot); if (t && t.human) t.name = c.name; }
        this.send(c, { t: 'welcome', you: c.slot, cfg: this.publicCfg(), dead: this.deadList(), apples: this.appleList() });
        this.broadcastLobby();
        this.maybeAutoStart();
        break;
      case 'lobby':
        if (c.slot < 0) return;
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
        if (c.slot < 0) return; // spectators can't start or restart
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
    const { mode, mapSize, seed, trees, scoreLimit, timeLimit, lives, pickups, powerups, zoom, quality, difficulty, lobby, players, season } = this.cfg;
    return { mode, mapSize, seed, trees, scoreLimit, timeLimit, lives, pickups, powerups, zoom, quality, difficulty, lobby, players, season };
  }

  humans() { return [...this.clients.values()].filter((c) => c.hello && c.slot >= 0); }

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
    // slow clients just miss a snapshot rather than buffering without limit
    for (const c of this.clients.values()) if (c.hello && !c.ws.congested) c.ws.send(msg);
  }

  broadcastLobby() {
    const msg = JSON.stringify({ t: 'lobby', state: this.sim.state, players: [...this.clients.values()].filter((c) => c.hello).map((c) => ({ id: c.id, slot: c.slot, name: c.name, type: c.type, ready: c.ready })) });
    for (const c of this.clients.values()) if (c.hello) c.ws.send(msg);
  }

  send(c, m) { c.ws.send(JSON.stringify(m)); }
}

function num(v) { return Number.isFinite(v) ? v : 0; }
function clampN(v, a, b) { return Math.max(a, Math.min(b, num(v))); }
