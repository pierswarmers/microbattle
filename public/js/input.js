// Keyboard, mouse and gamepad input mapped to up to four local players.

export const KEYMAPS = [
  { label: 'P1', up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], tl: ['KeyQ'], tr: ['KeyE'], pu: ['KeyR'], pd: ['KeyF'], fire: ['Space'], cycle: ['KeyC', 'ShiftLeft'], zoom: ['KeyV'],
    help: 'W A S D drive · Q E turret · R F barrel · SPACE fire · C weapon · V zoom · mouse aims too' },
  { label: 'P2', up: ['KeyI'], down: ['KeyK'], left: ['KeyJ'], right: ['KeyL'], tl: ['KeyU'], tr: ['KeyO'], pu: ['KeyY'], pd: ['KeyH'], fire: ['KeyN'], cycle: ['KeyM'], zoom: ['KeyB'],
    help: 'I J K L drive · U O turret · Y H barrel · N fire · M weapon · B zoom' },
  { label: 'P3', up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], tl: ['Numpad4', 'Comma'], tr: ['Numpad6', 'Period'], pu: ['Numpad8', 'BracketRight'], pd: ['Numpad5', 'Quote'], fire: ['Numpad0', 'Enter', 'ShiftRight'], cycle: ['NumpadAdd', 'Backslash'], zoom: ['NumpadSubtract', 'Slash'],
    help: 'Arrows drive · , . turret · ] \' barrel · ENTER fire · \\ weapon  (or numpad 4/6 8/5 0 +)' },
  { label: 'P4', up: [], down: [], left: [], right: [], tl: [], tr: [], pu: [], pd: [], fire: [], cycle: [], zoom: [],
    help: 'Gamepad: left stick drive · right stick aim · RT/A fire · LB/RB weapon · LT zoom' },
];

const PREVENT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Slash', 'Quote', 'Backquote', 'ShiftLeft', 'ShiftRight']);

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.pressed = new Set(); // edge-triggered this frame
    this.mouse = { x: 0, y: 0, moved: -1e9, buttons: 0, clicked: false, dx: 0, dy: 0, wheel: 0, locked: false, right: false };
    this.pads = [];
    this.padPrev = [];
    this.virtual = [{}, {}, {}, {}]; // scripted input for testing
    this.virtualPress = new Set();
    this.anyKey = false;
    window.addEventListener('keydown', (e) => {
      if (PREVENT.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
      this.anyKey = true;
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
    canvas.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left; this.mouse.y = e.clientY - r.top;
      this.mouse.moved = performance.now();
      if (this.mouse.locked) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; }
    });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) { this.mouse.buttons |= 1; this.mouse.clicked = true; }
      if (e.button === 2) this.mouse.right = true;
      this.anyKey = true;
      this.mouse.moved = performance.now();
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.buttons &= ~1;
      if (e.button === 2) this.mouse.right = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    document.addEventListener('pointerlockchange', () => { this.mouse.locked = document.pointerLockElement === canvas; });
  }

  requestLock() { if (!this.mouse.locked && this.canvas.requestPointerLock) this.canvas.requestPointerLock(); }
  releaseLock() { if (document.pointerLockElement) document.exitPointerLock(); }

  pollPads() {
    const list = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : [];
    this.padPrev = this.pads.map((p) => p.buttons.slice());
    this.pads = list.map((p) => ({ axes: p.axes.slice(), buttons: p.buttons.map((b) => b.value > 0.4) }));
  }

  padPressed(i, b) { const p = this.pads[i]; return !!(p && p.buttons[b] && !(this.padPrev[i] && this.padPrev[i][b])); }
  takePadPressed(i, b) { if (!this.padPressed(i, b)) return false; (this.padPrev[i] ||= [])[b] = true; return true; }

  any(codes) { for (const c of codes) if (this.down.has(c)) return true; return false; }
  anyPressed(codes) { for (const c of codes) if (this.pressed.has(c)) return true; return false; }
  /** Edge check that consumes the press so it fires exactly once even with several sim steps per frame. */
  takePressed(codes) { let hit = false; for (const c of codes) if (this.pressed.delete(c)) hit = true; return hit; }
  wasPressed(code) { const hit = this.pressed.has(code) || this.virtualPress.has(code); this.pressed.delete(code); this.virtualPress.delete(code); return hit; }

  /** Build the control state for local player `slot`. */
  player(slot) {
    const k = KEYMAPS[slot];
    const v = this.virtual[slot];
    const c = { throttle: 0, turn: 0, turretRate: 0, pitchRate: 0, fire: false, cycle: false, zoom: false, padAim: false, mouse: slot === 0 };
    c.throttle = (this.any(k.up) ? 1 : 0) - (this.any(k.down) ? 1 : 0);
    c.turn = (this.any(k.left) ? 1 : 0) - (this.any(k.right) ? 1 : 0);
    c.turretRate = (this.any(k.tl) ? 1 : 0) - (this.any(k.tr) ? 1 : 0);
    c.pitchRate = (this.any(k.pu) ? 1 : 0) - (this.any(k.pd) ? 1 : 0);
    c.fire = this.any(k.fire);
    c.cycle = this.takePressed(k.cycle);
    c.zoom = this.any(k.zoom);
    c.keyTurret = c.turretRate !== 0 || c.pitchRate !== 0;
    const p = this.pads[slot];
    if (p) {
      const dz = (x) => (Math.abs(x) < 0.18 ? 0 : x);
      const ly = dz(p.axes[1] || 0), lx = dz(p.axes[0] || 0), rx = dz(p.axes[2] || 0), ry = dz(p.axes[3] || 0);
      if (ly) c.throttle = -ly;
      if (lx) c.turn = -lx;
      if (p.buttons[12]) c.throttle = 1;
      if (p.buttons[13]) c.throttle = -1;
      if (p.buttons[14]) c.turn = 1;
      if (p.buttons[15]) c.turn = -1;
      if (rx) { c.turretRate = -rx; c.keyTurret = true; }
      if (ry) { c.pitchRate = -ry; c.keyTurret = true; }
      if (p.buttons[0] || p.buttons[7]) c.fire = true;
      if (p.buttons[6]) c.zoom = true;
      if (this.takePadPressed(slot, 4) || this.takePadPressed(slot, 5) || this.takePadPressed(slot, 2)) c.cycle = true;
    }
    if (v) {
      if (v.throttle !== undefined) c.throttle = v.throttle;
      if (v.turn !== undefined) c.turn = v.turn;
      if (v.turretRate !== undefined) { c.turretRate = v.turretRate; c.keyTurret = true; }
      if (v.pitchRate !== undefined) { c.pitchRate = v.pitchRate; c.keyTurret = true; }
      if (v.fire !== undefined) c.fire = v.fire;
      if (v.zoom !== undefined) c.zoom = v.zoom;
      if (v.cycle) { c.cycle = true; v.cycle = false; }
    }
    return c;
  }

  /** Player slot pressed its "join" (fire) control this frame. */
  joinPressed(slot) {
    const k = KEYMAPS[slot];
    return this.takePressed(k.fire) || this.takePadPressed(slot, 0) || this.takePadPressed(slot, 7);
  }

  /** Called once per rendered frame; edge state is only dropped after the simulation had a chance to see it. */
  endFrame(stepped = true) {
    if (!stepped) return;
    this.pressed.clear();
    this.virtualPress.clear();
    this.mouse.clicked = false;
    this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0;
  }
}
