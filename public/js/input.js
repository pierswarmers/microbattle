// Keyboard, mouse and gamepad input for the one player at this machine.
//   W A S D      drive              Arrow keys   turret (←/→) and barrel / range (↑/↓)
//   Space / LMB  fire               Q / E        previous / next weapon (1-8 pick directly)
//   C            change view        V / RMB      zoom (commander view)
//   G            smoke grenade      Esc          help
//   Mouse        aims (click to capture it in chase / commander view)

export const CONTROLS_HELP = [
  ['W A S D', 'drive'],
  ['← →', 'turn turret'],
  ['↑ ↓', 'barrel up / down (range for seekers & strikes)'],
  ['Space', 'fire'],
  ['Q / E', 'previous / next weapon  (1-8 direct)'],
  ['C', 'change view'],
  ['V', 'zoom (commander view)'],
  ['G', 'smoke grenade'],
  ['Mouse', 'aim · click fire · right-click zoom · wheel zoom (bird\'s-eye)'],
  ['M', 'mute'],
];

const PREVENT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Slash', 'Quote', 'Backquote']);

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.pressed = new Set();
    this.mouse = { x: 0, y: 0, moved: -1e9, buttons: 0, clicked: false, dx: 0, dy: 0, wheel: 0, locked: false, right: false };
    this.pads = [];
    this.padPrev = [];
    this.virtual = {}; // scripted input for testing
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
      if (this.mouse.locked) { this.mouse.dx += e.movementX || 0; this.mouse.dy += e.movementY || 0; }
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

  padPressed(b) { const p = this.pads[0]; return !!(p && p.buttons[b] && !(this.padPrev[0] && this.padPrev[0][b])); }
  any(...codes) { for (const c of codes) if (this.down.has(c)) return true; return false; }
  /** Edge-triggered and consumed, so it fires exactly once. */
  take(...codes) { let hit = false; for (const c of codes) if (this.pressed.delete(c)) hit = true; return hit; }

  /** The control state for this frame. */
  read() {
    const c = { throttle: 0, turn: 0, turret: 0, elev: 0, fire: false, prev: false, next: false, pick: -1, view: false, zoom: false, smoke: false, keyAim: false };
    c.throttle = (this.any('KeyW') ? 1 : 0) - (this.any('KeyS') ? 1 : 0);
    c.turn = (this.any('KeyA') ? 1 : 0) - (this.any('KeyD') ? 1 : 0);
    c.turret = (this.any('ArrowLeft') ? 1 : 0) - (this.any('ArrowRight') ? 1 : 0);
    c.elev = (this.any('ArrowUp') ? 1 : 0) - (this.any('ArrowDown') ? 1 : 0);
    c.fire = this.any('Space');
    c.prev = this.take('KeyQ');
    c.next = this.take('KeyE');
    for (let i = 1; i <= 8; i++) if (this.take('Digit' + i)) c.pick = i - 1;
    c.view = this.take('KeyC');
    c.zoom = this.any('KeyV');
    c.smoke = this.take('KeyG');
    const p = this.pads[0];
    if (p) {
      const dz = (x) => (Math.abs(x) < 0.18 ? 0 : x);
      const ly = dz(p.axes[1] || 0), lx = dz(p.axes[0] || 0), rx = dz(p.axes[2] || 0), ry = dz(p.axes[3] || 0);
      if (ly) c.throttle = -ly;
      if (lx) c.turn = -lx;
      if (rx) c.turret = -rx;
      if (ry) c.elev = -ry;
      if (p.buttons[0] || p.buttons[7]) c.fire = true;
      if (p.buttons[6]) c.zoom = true;
      if (this.padPressed(4)) c.prev = true;
      if (this.padPressed(5)) c.next = true;
      if (this.padPressed(3)) c.view = true;
      if (this.padPressed(1)) c.smoke = true;
    }
    const v = this.virtual;
    for (const k of Object.keys(v)) {
      if (['prev', 'next', 'view', 'smoke'].includes(k)) { if (v[k]) { c[k] = true; v[k] = false; } }
      else if (k === 'pick') { if (v.pick >= 0) { c.pick = v.pick; v.pick = -1; } }
      else c[k] = v[k];
    }
    c.keyAim = c.turret !== 0 || c.elev !== 0;
    return c;
  }

  endFrame() {
    this.pressed.clear();
    this.mouse.clicked = false;
    this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0;
  }
}
