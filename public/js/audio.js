// Procedural WebAudio sound effects and a bouncy chiptune soundtrack. No samples, all synthesized.

export class Sound {
  constructor(cfg) {
    this.volume = cfg.volume;
    this.musicOn = cfg.music;
    this.muted = cfg.mute;
    this.ctx = null;
    this.engines = new Map();
    this.last = {};
  }

  /** Must be called from a user gesture. */
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = 0.22; this.musicBus.connect(this.master);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    if (this.musicOn) this.startMusic();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  get ready() { return !!this.ctx && this.ctx.state === 'running'; }

  // ---------- building blocks ----------
  out(vol, pan) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = vol;
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p).connect(this.sfx);
    } else g.connect(this.sfx);
    return g;
  }

  noiseBurst(dest, t, dur, type, f0, f1, q = 1, vol = 1, attack = 0.003) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  tone(dest, t, dur, type, f0, f1, vol = 1, attack = 0.005) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Play a named effect. vol/pan already include distance attenuation. */
  play(name, vol = 1, pan = 0, opts = {}) {
    if (!this.ready || this.muted || vol < 0.02) return;
    const now = this.ctx.currentTime;
    // rate-limit spammy sounds
    const minGap = { mg: 0.03, rapid: 0.03, flame: 0.07, hit: 0.03, bush: 0.05, ping: 0.04, bomblet: 0.035, lockBeep: 0.12 }[name] || 0;
    if (minGap && this.last[name] && now - this.last[name] < minGap) return;
    this.last[name] = now;
    const t = now + 0.005;
    const d = this.out(vol, pan);
    switch (name) {
      case 'cannon':
        this.noiseBurst(d, t, 0.45, 'lowpass', 2400, 180, 0.7, 0.9);
        this.tone(d, t, 0.35, 'sine', 140, 40, 0.9);
        this.tone(d, t, 0.08, 'square', 300, 120, 0.15);
        break;
      case 'bigcannon':
        this.noiseBurst(d, t, 0.7, 'lowpass', 1800, 90, 0.7, 1);
        this.tone(d, t, 0.6, 'sine', 100, 28, 1);
        this.tone(d, t, 0.12, 'sawtooth', 200, 60, 0.2);
        break;
      case 'standard':
        this.noiseBurst(d, t, 0.45, 'lowpass', 2400, 180, 0.7, 0.9);
        this.tone(d, t, 0.35, 'sine', 140, 40, 0.9);
        this.tone(d, t, 0.08, 'square', 300, 120, 0.15);
        break;
      case 'highvel':
        // supersonic crack + deep thump
        this.noiseBurst(d, t, 0.12, 'highpass', 6000, 2500, 0.7, 1);
        this.noiseBurst(d, t, 0.8, 'lowpass', 1500, 70, 0.6, 1);
        this.tone(d, t, 0.6, 'sine', 120, 30, 1.2);
        this.tone(d, t, 0.18, 'sawtooth', 900, 120, 0.25);
        break;
      case 'hvhit':
        this.tone(d, t, 0.5, 'triangle', 1400, 300, 0.6);
        this.tone(d, t, 0.35, 'square', 2200, 600, 0.12);
        this.noiseBurst(d, t, 0.3, 'bandpass', 3000, 800, 1.2, 0.7);
        this.tone(d, t, 0.4, 'sine', 90, 35, 0.9);
        break;
      case 'seeker':
        this.noiseBurst(d, t, 0.9, 'bandpass', 250, 3000, 2, 0.75, 0.03);
        this.tone(d, t, 0.6, 'sawtooth', 180, 700, 0.08, 0.03);
        break;
      case 'massive':
        this.noiseBurst(d, t, 0.9, 'lowpass', 1200, 60, 0.6, 1);
        this.tone(d, t, 0.8, 'sine', 70, 25, 1.3);
        break;
      case 'nuke': {
        // a long, rolling, chest-thumping rumble
        this.noiseBurst(d, t, 3.5, 'lowpass', 1800, 40, 0.5, 1.2, 0.01);
        this.tone(d, t, 3.0, 'sine', 55, 18, 1.4, 0.02);
        this.tone(d, t + 0.1, 2.5, 'triangle', 80, 25, 0.6, 0.05);
        this.noiseBurst(d, t + 0.4, 4, 'bandpass', 400, 80, 0.6, 0.6, 0.6);
        for (let i = 0; i < 14; i++) this.noiseBurst(d, t + 0.2 + Math.random() * 2.5, 0.06, 'highpass', 2500, 1500, 1, 0.25);
        break;
      }
      case 'cluster':
        this.noiseBurst(d, t, 0.6, 'lowpass', 2000, 150, 0.6, 0.8);
        this.tone(d, t, 0.35, 'sine', 120, 40, 0.8);
        break;
      case 'clusterPop':
        this.tone(d, t, 0.2, 'square', 900, 200, 0.25);
        this.noiseBurst(d, t, 0.25, 'bandpass', 2500, 600, 1, 0.6);
        break;
      case 'bomblet':
        this.noiseBurst(d, t, 0.22 + Math.random() * 0.1, 'lowpass', 2600, 150, 0.7, 0.75);
        this.tone(d, t, 0.18, 'sine', 160 + Math.random() * 80, 50, 0.6);
        this.tone(d, t, 0.06, 'square', 600 + Math.random() * 600, 300, 0.12);
        break;
      case 'rapid':
        this.noiseBurst(d, t, 0.05, 'highpass', 1800, 900, 0.8, 0.5);
        this.tone(d, t, 0.045, 'square', 220 + Math.random() * 60, 110, 0.18);
        break;
      case 'strike':
        this.tone(d, t, 0.2, 'square', 1200, 1200, 0.15);
        this.noiseBurst(d, t, 0.5, 'bandpass', 1500, 600, 1, 0.3, 0.02);
        break;
      case 'siren':
        for (let i = 0; i < 3; i++) this.tone(d, t + i * 0.8, 0.8, 'sawtooth', 500, 900, 0.12, 0.3);
        break;
      case 'jet':
        this.noiseBurst(d, t, 2.4, 'bandpass', 600, 3500, 1.5, 0.9, 0.9);
        this.noiseBurst(d, t + 0.9, 1.6, 'lowpass', 3000, 300, 0.7, 0.6, 0.2);
        this.tone(d, t + 0.3, 1.8, 'sawtooth', 300, 120, 0.05, 0.6);
        break;
      case 'bomb':
        this.noiseBurst(d, t, 0.8, 'lowpass', 2200, 60, 0.6, 1);
        this.tone(d, t, 0.6, 'sine', 80, 25, 1);
        break;
      case 'smoke':
        this.noiseBurst(d, t, 1.4, 'highpass', 3000, 1500, 0.5, 0.35, 0.05);
        this.tone(d, t, 0.1, 'triangle', 300, 200, 0.2);
        break;
      case 'ignite':
        this.noiseBurst(d, t, 0.9, 'lowpass', 600, 2500, 0.8, 1, 0.05);
        this.tone(d, t, 0.5, 'sawtooth', 120, 60, 0.3);
        [880, 660, 440].forEach((f, i) => this.tone(d, t + 0.3 + i * 0.15, 0.13, 'square', f, f, 0.12));
        break;
      case 'lockBeep':
        this.tone(d, t, 0.05, 'square', 1800, 1800, 0.1);
        break;
      case 'locked':
        this.tone(d, t, 0.35, 'square', 2400, 2400, 0.12);
        break;
      case 'mg':
        this.noiseBurst(d, t, 0.06, 'highpass', 1500, 800, 0.8, 0.5);
        this.tone(d, t, 0.05, 'square', 180 + Math.random() * 40, 90, 0.18);
        break;
      case 'rockets':
        this.noiseBurst(d, t, 0.55, 'bandpass', 300, 2600, 2, 0.7, 0.02);
        this.tone(d, t, 0.4, 'sawtooth', 220, 600, 0.08, 0.02);
        break;
      case 'mortar':
        this.tone(d, t, 0.25, 'sine', 120, 50, 1);
        this.noiseBurst(d, t, 0.25, 'lowpass', 900, 200, 1, 0.6);
        this.tone(d, t + 0.02, 0.12, 'triangle', 500, 300, 0.2);
        break;
      case 'whistle':
        this.tone(d, t, opts.dur || 1.0, 'sine', 2200, 700, 0.18, 0.1);
        break;
      case 'rail':
        this.tone(d, t, 0.45, 'sawtooth', 1800, 120, 0.35);
        this.tone(d, t, 0.6, 'sine', 2600, 2400, 0.2, 0.01);
        this.noiseBurst(d, t, 0.3, 'highpass', 4000, 1200, 0.7, 0.4);
        this.tone(d, t, 0.25, 'sine', 90, 40, 0.8);
        break;
      case 'charge':
        this.tone(d, t, 0.3, 'sine', 400, 1600, 0.15, 0.02);
        break;
      case 'flame':
        this.noiseBurst(d, t, 0.16, 'bandpass', 700, 400, 0.8, 0.45, 0.02);
        break;
      case 'mine':
        this.tone(d, t, 0.08, 'square', 900, 900, 0.2);
        this.tone(d, t + 0.1, 0.08, 'square', 1200, 1200, 0.2);
        break;
      case 'beep':
        this.tone(d, t, 0.06, 'square', 1500, 1500, 0.12);
        break;
      case 'explosion': {
        const s = opts.size || 1;
        this.noiseBurst(d, t, 0.6 + s * 0.45, 'lowpass', 3000, 60, 0.6, 1, 0.004);
        this.tone(d, t, 0.5 + s * 0.3, 'sine', 90, 25, 1.1);
        this.noiseBurst(d, t + 0.05, 0.9 + s * 0.4, 'bandpass', 900, 200, 0.5, 0.4, 0.05);
        // crackle
        for (let i = 0; i < 4 + s * 3; i++) this.noiseBurst(d, t + 0.1 + Math.random() * 0.6, 0.04, 'highpass', 3000, 2000, 1, 0.25);
        break;
      }
      case 'hit':
        this.tone(d, t, 0.25, 'triangle', 900 + Math.random() * 300, 500, 0.4);
        this.tone(d, t, 0.18, 'square', 1400, 900, 0.08);
        this.noiseBurst(d, t, 0.08, 'highpass', 3000, 1500, 1, 0.3);
        break;
      case 'ping':
        this.tone(d, t, 0.14, 'sine', 2400 + Math.random() * 800, 900, 0.15);
        break;
      case 'shieldHit':
        this.tone(d, t, 0.3, 'sine', 600, 1400, 0.3);
        this.tone(d, t, 0.25, 'triangle', 1200, 2200, 0.15);
        break;
      case 'splash':
        this.noiseBurst(d, t, 0.5, 'bandpass', 1800, 400, 0.8, 0.6, 0.01);
        this.tone(d, t, 0.2, 'sine', 600, 200, 0.2);
        break;
      case 'crate':
        this.noiseBurst(d, t, 0.25, 'bandpass', 1200, 500, 1.5, 0.8);
        this.tone(d, t, 0.12, 'triangle', 200, 120, 0.4);
        break;
      case 'bush':
        this.noiseBurst(d, t, 0.25, 'highpass', 2500, 1200, 0.5, 0.35, 0.02);
        break;
      case 'pickup':
        [523, 659, 784, 1046].forEach((f, i) => this.tone(d, t + i * 0.06, 0.12, 'square', f, f, 0.12));
        break;
      case 'health':
        [392, 523, 659, 784].forEach((f, i) => this.tone(d, t + i * 0.07, 0.2, 'triangle', f, f, 0.3));
        break;
      case 'power':
        this.tone(d, t, 0.5, 'sawtooth', 200, 1600, 0.12, 0.02);
        [1046, 1318, 1568, 2093].forEach((f, i) => this.tone(d, t + 0.2 + i * 0.05, 0.15, 'sine', f, f, 0.2));
        break;
      case 'switch':
        this.tone(d, t, 0.04, 'square', 700, 700, 0.15);
        this.tone(d, t + 0.06, 0.04, 'square', 1000, 1000, 0.15);
        break;
      case 'empty':
        this.tone(d, t, 0.05, 'square', 220, 200, 0.15);
        break;
      case 'count':
        this.tone(d, t, 0.18, 'square', 440, 440, 0.25);
        break;
      case 'go':
        this.tone(d, t, 0.45, 'square', 880, 880, 0.25);
        this.tone(d, t, 0.45, 'square', 1320, 1320, 0.12);
        break;
      case 'death':
        [392, 370, 349, 262].forEach((f, i) => this.tone(d, t + i * 0.16, 0.22, 'sawtooth', f, f * 0.97, 0.15));
        break;
      case 'kill':
        [784, 988, 1175].forEach((f, i) => this.tone(d, t + i * 0.07, 0.14, 'square', f, f, 0.18));
        break;
      case 'respawn':
        this.tone(d, t, 0.4, 'triangle', 300, 900, 0.3, 0.05);
        break;
      case 'drop':
        this.tone(d, t, 0.9, 'sine', 900, 500, 0.15, 0.1);
        break;
      case 'win':
        [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => this.tone(d, t + i * 0.14, i === 6 ? 0.8 : 0.16, 'square', f, f, 0.2));
        break;
      case 'ram':
        this.tone(d, t, 0.3, 'triangle', 160, 70, 0.8);
        this.noiseBurst(d, t, 0.2, 'lowpass', 1500, 300, 1, 0.6);
        break;
    }
  }

  /** Continuous engine hum for a tank; level 0..1, pitch by speed. */
  engine(id, active, speed01, vol, pan) {
    if (!this.ready) return;
    let e = this.engines.get(id);
    if (!e) {
      const ctx = this.ctx;
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      const o2 = ctx.createOscillator(); o2.type = 'square';
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300; f.Q.value = 3;
      const g = ctx.createGain(); g.gain.value = 0;
      const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      o.connect(f); o2.connect(f); f.connect(g);
      if (p) g.connect(p).connect(this.sfx); else g.connect(this.sfx);
      o.start(); o2.start();
      e = { o, o2, f, g, p };
      this.engines.set(id, e);
    }
    const t = this.ctx.currentTime;
    const base = 38 + speed01 * 55;
    e.o.frequency.setTargetAtTime(base, t, 0.08);
    e.o2.frequency.setTargetAtTime(base * 0.5 + 3, t, 0.08);
    e.f.frequency.setTargetAtTime(220 + speed01 * 700, t, 0.1);
    e.g.gain.setTargetAtTime(active && !this.muted ? vol * (0.05 + speed01 * 0.07) : 0, t, 0.1);
    if (e.p) e.p.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, 0.1);
  }

  stopEngines() { for (const e of this.engines.values()) e.g.gain.value = 0; }

  // ---------- music: a cheerful looping chiptune ----------
  startMusic() {
    if (!this.ctx || this.musicTimer) return;
    const ctx = this.ctx;
    const bpm = 132, step = 60 / bpm / 4;
    // I - V - vi - IV in C, bouncy
    const roots = [48, 55, 57, 53];
    const arp = [0, 4, 7, 12, 7, 4, 0, 7];
    const melody = [76, null, 79, 76, 74, null, 72, null, 74, 76, null, 72, 69, null, 67, null,
      72, null, 74, 76, 79, null, 76, 74, 72, null, 74, null, 72, null, null, null];
    let n = 0;
    let next = ctx.currentTime + 0.1;
    const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const sched = () => {
      while (next < ctx.currentTime + 0.2) {
        const bar = Math.floor(n / 16) % 4, s = n % 16;
        const root = roots[bar];
        const minor = bar === 2;
        const chord = arp.map((x) => (minor && (x === 4) ? 3 : x));
        if (s % 2 === 0) this.tone(this.musicBus, next, step * 1.6, 'triangle', mtof(root - 12), mtof(root - 12), 0.55);
        this.tone(this.musicBus, next, step * 0.9, 'square', mtof(root + 12 + chord[s % 8]), mtof(root + 12 + chord[s % 8]), 0.07);
        const mel = melody[(n >> 1) % 32];
        if (s % 2 === 0 && mel) this.tone(this.musicBus, next, step * 1.8, 'square', mtof(mel), mtof(mel), 0.08);
        if (s % 4 === 0) { this.tone(this.musicBus, next, 0.12, 'sine', 150, 45, 0.7); }
        if (s % 8 === 4) this.noiseBurst(this.musicBus, next, 0.12, 'bandpass', 2500, 1500, 0.8, 0.35);
        if (s % 2 === 1) this.noiseBurst(this.musicBus, next, 0.03, 'highpass', 8000, 6000, 1, 0.12);
        next += step;
        n++;
      }
    };
    this.musicTimer = setInterval(sched, 50);
    sched();
  }

  stopMusic() { clearInterval(this.musicTimer); this.musicTimer = null; }
}
