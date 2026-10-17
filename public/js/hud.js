// 2D overlay for one player: lobby, scoreboard, weapon panel, gunner scope, chase/bird's-eye reticles,
// lock-on, air strike warnings, minimap, labels, comic pop-text, help and game over.
import { TANK_TYPES, WEAPONS, WEAPON_ORDER, POWERUPS, PLAYER_COLORS } from './defs.js';
import { CONTROLS_HELP } from './input.js';
import { VIEW_NAMES } from './client.js';
import { m4, clamp, wrapAngle } from './math.js';

const FONT = '"Arial Rounded MT Bold", "Trebuchet MS", "Verdana", sans-serif';
// heavy rounded comic lettering (drawn with a thick dark outline)
const COMIC = '"Arial Rounded MT Bold", "Baloo 2", "Fredoka", "Nunito", "Arial Black", sans-serif';
const KILL_ICONS = { standard: '💥', highvel: '⚡', seeker: '🚀', massive: '☢️', cluster: '🎆', flame: '🔥', burn: '🔥', fuel: '⛽', rapid: '🔫', strike: '✈️', ram: '🐏', barrel: '🛢️', chain: '💥', blast: '💥' };

export class HUD {
  constructor(canvas, client) {
    this.c = canvas;
    this.g = client;
    this.ctx = canvas.getContext('2d');
    this.tmp = [0, 0, 0, 0];
    this.miniCache = null;
  }

  resize(dpr) {
    const c = this.c;
    const w = Math.floor(c.clientWidth * dpr), h = Math.floor(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    this.dpr = dpr;
  }

  project(v, x, y, z) {
    const p = m4.transform(v.vp, x, y, z, 1, this.tmp);
    if (p[3] <= 0.01) return null;
    const nx = p[0] / p[3], ny = p[1] / p[3];
    return { x: v.x + (nx * 0.5 + 0.5) * v.w, y: v.y + (1 - (ny * 0.5 + 0.5)) * v.h, nx, ny, w: p[3] };
  }

  draw(v, dt) {
    const ctx = this.ctx, g = this.g;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const W = this.c.clientWidth, H = this.c.clientHeight;
    this.W = W; this.H = H;
    ctx.clearRect(0, 0, W, H);
    if (g.status !== 'open') this.banner(W / 2, H - 40, g.status === 'closed' ? 'Lost connection — reconnecting…' : 'Connecting…', '#ffd84d');
    if (g.state === 'lobby' || g.state === 'connecting') { this.drawLobby(W, H); return; }
    const me = g.me;
    this.drawWorldLabels(v);
    if (me && me.net.al && g.state !== 'over') {
      if (v.kind === 'commander') this.drawScope(v, me);
      else if (v.kind === 'chase') this.drawChaseReticle(v, me);
      else if (v.kind === 'birdseye') this.drawBirdsReticle(v, me);
    }
    if (me && !me.net.al && g.state !== 'over') this.drawDeadNotice(me, W, H);
    this.drawStrikeWarnings(v, me, W, H);
    if (me) this.drawPanel(me, 12, H - 12);
    this.drawMinimap(W - 12, H - 12, Math.min(170, W * 0.16), me);
    this.drawScoreboard(W);
    this.drawKillfeed(W);
    this.drawAnnouncements(W, H);
    this.drawViewLabel(W);
    if (g.dmgT > 0 && me && me.net.al) {
      const a = wrapAngle(g.dmgDir - (v.kind === 'birdseye' ? Math.PI : g.pred.yaw));
      ctx.strokeStyle = `rgba(255,40,30,${g.dmgT * 0.8})`; ctx.lineWidth = 12;
      ctx.beginPath(); ctx.arc(W / 2, H / 2, Math.min(W, H) * 0.3, -Math.PI / 2 - a - 0.3, -Math.PI / 2 - a + 0.3); ctx.stroke();
    }
    if (g.incoming > 0 && Math.floor(g.realTime * 6) % 2 === 0) this.banner(W / 2, H * 0.3, '⚠ MISSILE LOCK — POP SMOKE (G) OR HIDE UNDER TREES!', '#ff5a3a', 18);
    if (g.state === 'countdown') this.drawCountdown(W, H);
    if (g.state === 'over') this.drawGameOver(W, H);
    if (g.flash > 0) { ctx.fillStyle = `rgba(255,250,235,${Math.min(1, g.flash * 1.2)})`; ctx.fillRect(0, 0, W, H); }
    if (g.help) this.drawHelp(W, H);
    else if (!g.audioStarted && g.state === 'countdown') this.label(W / 2, H * 0.55, '🔊 press any key or click to enable sound', 13, 'rgba(255,255,255,0.85)', 'center');
    if (g.opts.debug) this.label(8, H - 150, `${g.fps.toFixed(0)} fps · ${g.fx.parts.length} particles · ${g.proj.size} proj · view ${v.kind}`, 12, '#fff', 'left', 'bottom');
  }

  // ---------- primitives ----------
  label(x, y, text, size, col, align = 'left', base = 'middle', font = FONT, stroke = 'rgba(0,0,0,0.75)') {
    const ctx = this.ctx;
    ctx.font = `bold ${size}px ${font}`;
    ctx.textAlign = align; ctx.textBaseline = base;
    if (stroke) { ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(2, size / 5); ctx.strokeStyle = stroke; ctx.strokeText(text, x, y); }
    ctx.fillStyle = col; ctx.fillText(text, x, y);
  }

  banner(x, y, text, col, size = 16) {
    this.ctx.font = `bold ${size}px ${FONT}`;
    const w = this.ctx.measureText(text).width + 30;
    this.roundRect(x - w / 2, y - size, w, size * 2, size, 'rgba(10,12,25,0.7)', col);
    this.label(x, y, text, size, col, 'center');
  }

  roundRect(x, y, w, h, r, fill, stroke) {
    const ctx = this.ctx;
    r = Math.min(r, h / 2, w / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
  }

  bar(x, y, w, h, frac, col, bg = 'rgba(0,0,0,0.55)') {
    this.roundRect(x, y, w, h, h / 2, bg);
    if (frac > 0) this.roundRect(x, y, Math.max(h, w * clamp(frac, 0, 1)), h, h / 2, col);
  }

  // ---------- world labels ----------
  drawWorldLabels(v) {
    const g = this.g, ctx = this.ctx;
    const birds = v.kind === 'birdseye' || v.kind === 'winner';
    for (const t of g.tanks.values()) {
      const n = t.net;
      if (!n.al) continue;
      if (t.id === g.you && v.kind === 'commander') continue;
      if (n.pw.ghost && t.id !== g.you) continue;
      const p = this.project(v, t.x, t.y + 3.4 * t.scale, t.z);
      if (!p || Math.abs(p.nx) > 1.1 || Math.abs(p.ny) > 1.1) continue;
      if (!birds && p.w > 280) continue;
      const k = birds ? 1 : clamp(60 / p.w, 0.55, 1);
      const w = 46 * k;
      const name = n.name.replace(' (bot)', '') + (t.id === g.you ? ' (you)' : '');
      if (v.kind === 'commander' || v.kind === 'chase') {
        if (t.id !== g.you) {
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.PI / 4);
          ctx.strokeStyle = t.css; ctx.lineWidth = 2; ctx.strokeRect(-6 * k, -6 * k, 12 * k, 12 * k);
          ctx.restore();
          this.label(p.x, p.y - 16 * k, `${name} ${Math.round(p.w)}m`, 11 * k + 2, t.css, 'center');
        }
        this.bar(p.x - w / 2, p.y - 30 * k, w, 5, n.hp / n.mhp, hpCol(n.hp / n.mhp));
      } else {
        this.label(p.x, p.y - 14, name, 12, t.css, 'center');
        this.bar(p.x - w / 2, p.y - 5, w, 6, n.hp / n.mhp, hpCol(n.hp / n.mhp));
        if (n.sh > 0) this.bar(p.x - w / 2, p.y + 3, w * (n.sh / POWERUPS.shield.absorb), 3, 1, '#8899ff');
      }
      if (g.lock.cand === t.id) {
        const prog = clamp(g.lock.t / WEAPONS.seeker.lockTime, 0, 1);
        const s = 34 - prog * 14;
        const locked = g.lock.id === t.id;
        ctx.strokeStyle = locked ? '#ff3b30' : '#ffd84d'; ctx.lineWidth = 3;
        const q = this.project(v, t.x, t.y + 1.2, t.z);
        if (q) {
          ctx.strokeRect(q.x - s, q.y - s, s * 2, s * 2);
          this.label(q.x, q.y + s + 12, locked ? 'LOCKED' : 'LOCKING…', 13, locked ? '#ff3b30' : '#ffd84d', 'center');
        }
      }
    }
    if (birds) for (const p of g.pickups) {
      if (!p.active) continue;
      const q = this.project(v, p.x, p.y + 4.2, p.z);
      if (!q || Math.abs(q.nx) > 1 || Math.abs(q.ny) > 1) continue;
      const icon = p.kind === 'health' ? '❤️' : p.kind === 'ammo' ? '🧨' : p.kind === 'weapon' ? (p.sub === 'massive' ? '☢️' : '🎁') : { speed: '⚡', shield: '🛡️', damage: '💪', rapid: '⏩', ghost: '👻' }[p.sub];
      ctx.font = '16px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(icon, q.x, q.y + Math.sin(p.spin * 2.2) * 3);
    }
    for (const tx of g.fx.texts) {
      const p = this.project(v, tx.x, tx.y, tx.z);
      if (!p || p.w > 400) continue;
      const a = tx.age / tx.life;
      const pop = a < 0.15 ? 0.4 + (a / 0.15) * 0.9 : a < 0.25 ? 1.3 - ((a - 0.15) / 0.1) * 0.3 : 1;
      const base = tx.small ? 16 : 34;
      const size = base * tx.scale * pop * (birds ? clamp(120 / (v.camH || 120), 0.6, 1.3) : clamp(50 / p.w, 0.45, 1.15));
      ctx.save();
      ctx.globalAlpha = a > 0.7 ? 1 - (a - 0.7) / 0.3 : 1;
      ctx.translate(p.x, p.y); ctx.rotate(tx.rot);
      ctx.font = `900 ${size}px ${COMIC}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      if (!tx.small) { ctx.lineWidth = size / 3.5; ctx.strokeStyle = '#2a1033'; ctx.strokeText(tx.text, 0, 0); }
      ctx.lineWidth = size / 8; ctx.strokeStyle = tx.small ? '#000' : '#fff'; ctx.strokeText(tx.text, 0, 0);
      ctx.fillStyle = tx.col; ctx.fillText(tx.text, 0, 0);
      ctx.restore();
    }
    for (const d of g.drops) {
      const p = this.project(v, d.x, d.y + 9, d.z);
      if (p && Math.abs(p.nx) < 1 && Math.abs(p.ny) < 1) this.label(p.x, p.y, '📦 SUPPLY DROP', 12, '#ffd84d', 'center');
    }
  }

  // ---------- reticles ----------
  crosshair(x, y, col, r = 9) {
    const ctx = this.ctx;
    ctx.strokeStyle = col; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - r - 6, y); ctx.lineTo(x - r + 4, y); ctx.moveTo(x + r - 4, y); ctx.lineTo(x + r + 6, y); ctx.moveTo(x, y - r - 6); ctx.lineTo(x, y - r + 4); ctx.moveTo(x, y + r - 4); ctx.lineTo(x, y + r + 6); ctx.stroke();
  }

  drawChaseReticle(v, me) {
    const g = this.g;
    const W = WEAPONS[g.weapon || 'standard'];
    let pt = g.aimEnd;
    if (!pt) { const d = 80; pt = [me.muzzle[0] + me.dir[0] * d, me.muzzle[1] + me.dir[1] * d, me.muzzle[2] + me.dir[2] * d]; }
    const q = this.project(v, pt[0], pt[1], pt[2]);
    if (q) this.crosshair(q.x, q.y, me.css, W.kind === 'bullet' ? 9 + me.net.bloom * 120 : 9);
    this.reload(v.w / 2, v.h - 120, me, W);
    if (W.kind === 'seeker') this.label(v.w / 2, v.h - 150, 'Seeker lock-on: COMMANDER view (C) or bird\'s-eye multi-lock', 12, '#ffe08a', 'center');
    if (W.kind === 'strike' || W.kind === 'seeker' || g.rangedAim) this.label(v.w / 2, v.h - 92, `RANGE ${Math.round(g.aim.range)}m  (↑↓)`, 13, '#bfffd0', 'center');
  }

  drawBirdsReticle(v, me) {
    const g = this.g;
    const W = WEAPONS[g.weapon || 'standard'];
    if (g.aim.mouse && g.mouseTarget) { const q = this.project(v, ...g.mouseTarget); if (q) this.crosshair(q.x, q.y, me.css); }
    const p = this.project(v, me.x, me.y, me.z);
    if (p) this.reload(p.x, p.y + 30, me, W, 18);
    if (g.mlock.on) this.drawMultiLock(v, me, W);
    if (W.kind === 'strike' || W.kind === 'seeker' || g.rangedAim) this.label(v.w / 2, v.h - 160, `RANGE ${Math.round(g.aim.range)}m  (↑↓ or mouse)`, 13, '#bfffd0', 'center');
  }

  /** Bird's-eye seeker: the lock circle on the ground, a filling ring on each tank being locked, red brackets once locked. */
  drawMultiLock(v, me, W) {
    const g = this.g, ctx = this.ctx, M = g.mlock;
    const n = M.locked.length;
    const ammo = (me.net.w.find(([id]) => id === 'seeker') || [0, 0])[1];
    const col = n ? '#ff3b30' : '#ffd84d';
    ctx.save();
    ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.setLineDash([10, 7]); ctx.lineDashOffset = -g.realTime * 12;
    ctx.beginPath();
    for (let i = 0, first = true; i <= 48; i++) {
      const a = (i / 48) * Math.PI * 2, x = M.cx + Math.sin(a) * W.lockRadius, z = M.cz + Math.cos(a) * W.lockRadius;
      const q = this.project(v, x, g.world.heightAt(x, z) + 0.3, z);
      if (!q) { first = true; continue; }
      if (first) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
      first = false;
    }
    ctx.stroke(); ctx.setLineDash([]);
    for (const [id, h] of M.prog) {
      const t = g.tanks.get(id);
      if (!t || !t.net.al) continue;
      const q = this.project(v, t.x, t.y + 1, t.z);
      if (!q) continue;
      const prog = clamp(h / W.multiLockTime, 0, 1);
      if (prog < 1) {
        ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(q.x, q.y, 24, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = '#ffd84d'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(q.x, q.y, 24, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2); ctx.stroke();
      } else {
        const s = 22 + Math.sin(g.realTime * 10) * 2, k = 9;
        ctx.strokeStyle = '#ff3b30'; ctx.lineWidth = 3.5; ctx.beginPath();
        for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { ctx.moveTo(q.x + a * s, q.y + b * (s - k)); ctx.lineTo(q.x + a * s, q.y + b * s); ctx.lineTo(q.x + a * (s - k), q.y + b * s); }
        ctx.stroke();
        this.label(q.x, q.y + s + 12, 'LOCKED', 12, '#ff3b30', 'center');
      }
    }
    ctx.restore();
    const msg = n ? `${n} LOCKED — FIRE launches ${Math.min(n, ammo)} seeker${Math.min(n, ammo) === 1 ? '' : 's'}` : M.reason || 'hold tanks inside the circle to lock on';
    this.label(v.w / 2, v.h - 182, msg, n ? 15 : 13, n ? '#ff6a5a' : M.reason ? '#ff8a6a' : '#ffe08a', 'center');
  }

  reload(x, y, me, W, r = 14) {
    const ctx = this.ctx, e = me.net;
    const frac = W.kind === 'strike' && e.scd > 0 ? 1 - e.scd / W.cooldown : clamp(1 - e.cd / Math.max(0.05, W.reload * (W.id === 'standard' ? me.def.gun.reload : 1)), 0, 1);
    if (frac >= 1) return;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,200,80,0.95)'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); ctx.stroke();
  }

  drawScope(v, me) {
    const g = this.g, ctx = this.ctx;
    const cx = v.x + v.w / 2, cy = v.y + v.h / 2;
    const R = Math.min(v.w, v.h) * 0.45;
    const W = WEAPONS[g.weapon || 'standard'];
    ctx.save();
    ctx.beginPath(); ctx.rect(v.x, v.y, v.w, v.h); ctx.arc(cx, cy, R, 0, Math.PI * 2, true);
    ctx.fillStyle = 'rgba(14,18,24,0.88)'; ctx.fill('evenodd');
    const grad = ctx.createRadialGradient(cx, cy, R * 0.7, cx, cy, R * 1.05);
    grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = me.css; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    const col = 'rgba(255,255,255,0.92)';
    ctx.strokeStyle = col; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx - R * 0.95, cy); ctx.lineTo(cx - 26, cy); ctx.moveTo(cx + 26, cy); ctx.lineTo(cx + R * 0.95, cy); ctx.moveTo(cx, cy + 26); ctx.lineTo(cx, cy + R * 0.7); ctx.stroke();
    ctx.strokeStyle = me.css; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cx - 14, cy + 14); ctx.lineTo(cx, cy); ctx.lineTo(cx + 14, cy + 14); ctx.stroke();
    ctx.strokeStyle = col; ctx.lineWidth = 1.5;
    for (let i = 1; i <= 6; i++) { const d = i * R * 0.13; ctx.beginPath(); ctx.moveTo(cx - d, cy - 6); ctx.lineTo(cx - d, cy + 6); ctx.moveTo(cx + d, cy - 6); ctx.lineTo(cx + d, cy + 6); ctx.stroke(); }
    for (let i = 1; i <= 4; i++) { const d = i * R * 0.14; ctx.beginPath(); ctx.moveTo(cx - 8 + i, cy + d); ctx.lineTo(cx + 8 - i, cy + d); ctx.stroke(); }
    if (W.kind === 'seeker') { ctx.strokeStyle = 'rgba(255,216,77,0.6)'; ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.arc(cx, cy, v.h * 0.06 * 2, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
    if (W.kind === 'bullet') { ctx.strokeStyle = 'rgba(255,230,120,0.7)'; ctx.beginPath(); ctx.arc(cx, cy, 10 + me.net.bloom * 600, 0, Math.PI * 2); ctx.stroke(); }
    const dYaw = wrapAngle(g.aim.yaw - g.pred.yaw);
    if (Math.abs(dYaw) > 0.03) {
      const sxp = me.muzzle[0] + Math.sin(g.aim.yaw) * 80, syp = me.muzzle[1] + Math.tan(g.aim.pitch) * 80, szp = me.muzzle[2] + Math.cos(g.aim.yaw) * 80;
      const q = this.project(v, sxp, syp, szp);
      ctx.strokeStyle = 'rgba(255,230,120,0.9)'; ctx.lineWidth = 2;
      if (q && Math.abs(q.nx) < 1 && Math.abs(q.ny) < 1) { ctx.beginPath(); ctx.arc(q.x, q.y, 7, 0, Math.PI * 2); ctx.stroke(); }
      else { const a = -Math.sign(dYaw); ctx.beginPath(); ctx.moveTo(cx + a * (R - 14), cy - 10); ctx.lineTo(cx + a * (R - 2), cy); ctx.lineTo(cx + a * (R - 14), cy + 10); ctx.stroke(); }
    }
    this.reload(cx, cy, me, W, 38);
    if (g.hitMarkT > 0) {
      ctx.strokeStyle = `rgba(255,80,60,${g.hitMarkT * 4})`; ctx.lineWidth = 3;
      ctx.beginPath(); for (const [a, b] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { ctx.moveTo(cx + a * 10, cy + b * 10); ctx.lineTo(cx + a * 22, cy + b * 22); } ctx.stroke();
    }
    const lobbed = W.kind === 'seeker' || W.kind === 'strike' || g.rangedAim;
    const range = lobbed && !v.impact ? (g.lock.id >= 0 ? g.lockDist : g.aim.range) : v.impact ? Math.hypot(v.impact[0] - me.x, v.impact[2] - me.z) : g.rangeAlongGun(me);
    this.label(cx + 50, cy + 22, range ? `RNG ${Math.round(range)}m` : 'RNG ---', 13, '#bfffd0', 'left');
    this.label(cx + 50, cy + 40, lobbed ? 'RANGE ↑↓' : `ELV ${(me.p * 57.3).toFixed(1)}°`, 12, '#bfffd0', 'left');
    if (g.zoomed) this.label(cx + 50, cy - 22, `ZOOM ${me.def.zoom}x`, 13, '#ffe08a', 'left');
    if (W.kind === 'seeker' && g.lock.cand < 0) this.label(cx, cy + R * 0.78, g.lock.reason || 'hold a tank inside the circle to lock on', g.lock.reason ? 14 : 12, g.lock.reason ? '#ff8a6a' : '#ffe08a', 'center');
    const heading = ((-me.ty * 180) / Math.PI + 180 + 3600) % 360;
    const tapeW = Math.min(v.w * 0.5, 360), tx = cx - tapeW / 2, ty = 76;
    this.roundRect(tx, ty - 12, tapeW, 26, 6, 'rgba(0,0,0,0.5)');
    ctx.save(); ctx.beginPath(); ctx.rect(tx, ty - 14, tapeW, 30); ctx.clip();
    for (let d = -60; d <= 60; d += 5) {
      const hd = Math.round(heading / 5) * 5 + d;
      const x = cx + (hd - heading) * (tapeW / 120);
      const deg = ((hd % 360) + 360) % 360;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, ty + 12); ctx.lineTo(x, ty + (deg % 15 === 0 ? 2 : 7)); ctx.stroke();
      if (deg % 45 === 0) this.label(x, ty - 2, { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' }[deg], 11, '#ffe08a', 'center', 'middle', FONT, null);
    }
    ctx.restore();
    ctx.fillStyle = me.css; ctx.beginPath(); ctx.moveTo(cx, ty + 14); ctx.lineTo(cx - 6, ty + 22); ctx.lineTo(cx + 6, ty + 22); ctx.fill();
    const ix = cx, iy = v.y + v.h - 46;
    ctx.save(); ctx.translate(ix, iy); ctx.rotate(-(me.yaw - me.ty));
    this.roundRect(-11, -16, 22, 32, 4, 'rgba(0,0,0,0.4)', me.css);
    ctx.fillStyle = me.css; ctx.fillRect(-11, -18, 22, 4);
    ctx.restore();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(ix, iy); ctx.lineTo(ix, iy - 26); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ix, iy, 6, 0, Math.PI * 2); ctx.fill();
    this.label(ix, iy + 28, 'HULL', 9, 'rgba(255,255,255,0.7)', 'center');
  }

  drawDeadNotice(me, W, H) {
    if (me.net.el) { this.label(W / 2, H * 0.35, 'ELIMINATED', 40, '#ff5a5a', 'center', 'middle', COMIC); return; }
    this.label(W / 2, H * 0.35, 'DESTROYED!', 44, '#ff7a3a', 'center', 'middle', COMIC);
    this.label(W / 2, H * 0.35 + 40, `respawning in ${me.net.rt.toFixed(1)}s`, 16, '#fff', 'center');
  }

  drawStrikeWarnings(v, me, W, H) {
    const g = this.g;
    for (const s of g.strikes) {
      if (s.t <= 0) continue;
      const q = this.project(v, s.x, g.world.heightAt(s.x, s.z) + 6, s.z);
      if (q && Math.abs(q.nx) < 1.05 && Math.abs(q.ny) < 1.05) this.label(q.x, q.y, `✈ ${s.t.toFixed(1)}`, 22, '#ff4a3a', 'center', 'middle', COMIC, '#2a1033');
      if (me && me.net.al && Math.hypot(me.x - s.x, me.z - s.z) < s.r + 6 && Math.floor(g.realTime * 5) % 2 === 0) this.banner(W / 2, H - 175, `GET OUT! AIR STRIKE IN ${s.t.toFixed(1)}s`, '#ff4a3a', 20);
    }
  }

  // ---------- player panel ----------
  drawPanel(me, x, y) {
    const g = this.g, e = me.net;
    const w = 330, h = 128;
    const px = x, py = y - h;
    this.roundRect(px, py, w, h, 12, 'rgba(15,20,35,0.66)', me.css);
    this.label(px + 12, py + 15, e.name, 15, me.css, 'left');
    this.label(px + w - 12, py + 15, `${me.def.name.toUpperCase()} · ${me.def.role}`, 11, '#dfe6ff', 'right');
    if (e.al) {
      this.bar(px + 12, py + 28, w - 24, 12, e.hp / e.mhp, hpCol(e.hp / e.mhp));
      this.label(px + w / 2, py + 34, `${e.hp} / ${e.mhp}`, 10, '#fff', 'center');
      if (e.sh > 0) this.bar(px + 12, py + 42, (w - 24) * (e.sh / POWERUPS.shield.absorb), 4, 1, '#8899ff');
    } else this.label(px + w / 2, py + 34, e.el ? 'ELIMINATED' : `RESPAWN ${e.rt.toFixed(1)}s`, 13, '#ff8a6a', 'center');
    const owned = new Map(e.w.map(([id, a]) => [id, a]));
    const bw = (w - 24 - 7 * 3) / 8;
    WEAPON_ORDER.forEach((id, i) => {
      const W = WEAPONS[id];
      const bx = px + 12 + i * (bw + 3), by = py + 50;
      const has = owned.has(id), sel = g.weapon === id;
      this.roundRect(bx, by, bw, 40, 6, sel ? 'rgba(255,255,255,0.25)' : has ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.15)', sel ? '#fff' : null);
      this.label(bx + 4, by + 8, String(i + 1), 9, has ? '#9ab' : '#556', 'left');
      this.label(bx + bw / 2, by + 17, W.short, 9, has ? (sel ? '#fff' : '#cde') : '#556', 'center');
      if (has) {
        let txt = String(owned.get(id)), col = owned.get(id) > 0 ? '#fff' : '#ff6a6a';
        if (id === 'strike' && e.scd > 0) { txt = `${Math.ceil(e.scd)}s`; col = '#ffb070'; }
        this.label(bx + bw / 2, by + 31, txt, 12, col, 'center');
      }
    });
    const ry = py + 106;
    this.label(px + 12, ry, `SMOKE ×${e.sm} (G)`, 11, '#dde', 'left');
    this.label(px + w - 12, ry, `${WEAPONS[g.weapon || 'standard'].name}  ·  Q/E`, 11, '#ffe08a', 'right');
    if (g.weapon === 'flame' || e.heat > 0.1) {
      const f = e.heat / 4;
      this.label(px + 112, ry, 'HEAT', 10, f > 0.6 ? '#ff6a3a' : '#ffd0a0', 'left');
      this.bar(px + 144, ry - 5, 60, 10, f, f > 0.6 ? '#ff4a2a' : '#ffa040');
      if (f > 0.6 && Math.floor(g.realTime * 6) % 2) this.label(px + 145, ry - 16, 'FIRE RISK!', 10, '#ff5a3a', 'left');
    }
    let ix = px + w + 8;
    for (const k in e.pw) {
      const P = POWERUPS[k];
      this.roundRect(ix, py + h - 24, 92, 22, 11, 'rgba(0,0,0,0.55)', P.css);
      this.label(ix + 46, py + h - 13, `${P.name.split(' ')[0]} ${Math.ceil(e.pw[k])}s`, 11, P.css, 'center');
      ix += 96;
    }
  }

  drawViewLabel() {
    const g = this.g;
    const any = g.cfg.mode === 'any';
    this.label(14, 22, `VIEW: ${VIEW_NAMES[g.view] || g.view}${any ? '  ·  C to switch' : ''}  ·  Esc help`, 12, g.viewFlash > 0 ? '#ffdd33' : 'rgba(255,255,255,0.75)', 'left');
    if (g.viewFlash > 0) this.label(this.W / 2, this.H * 0.16, VIEW_NAMES[g.view], 34, '#ffdd33', 'center', 'middle', COMIC, '#2a1033');
  }

  // ---------- minimap ----------
  drawMinimap(xr, yb, size, me) {
    const g = this.g, ctx = this.ctx, Wd = g.world;
    const x = xr - size, y = yb - size;
    if (!this.miniCache) {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const cx = c.getContext('2d');
      const img = cx.createImageData(128, 128);
      for (let j = 0; j < 128; j++) for (let i = 0; i < 128; i++) {
        const wx = -Wd.half + ((i + 0.5) / 128) * Wd.size, wz = -Wd.half + ((j + 0.5) / 128) * Wd.size;
        const h = Wd.heightAt(wx, wz);
        let col = [90, 170, 70];
        if (h < -1.05) col = [70, 150, 220];
        else if (Wd.pathDist(wx, wz) < 3) col = [200, 160, 100];
        else if (Wd.forestDensity(wx, wz) > 0.55) col = [55, 120, 50];
        if (!Wd.inBounds(wx, wz)) col = [120, 130, 110];
        const k = (j * 128 + i) * 4;
        img.data[k] = col[0]; img.data[k + 1] = col[1]; img.data[k + 2] = col[2]; img.data[k + 3] = 255;
      }
      cx.putImageData(img, 0, 0);
      this.miniCache = c;
    }
    ctx.save();
    this.roundRect(x - 3, y - 3, size + 6, size + 6, 10, 'rgba(10,15,25,0.7)');
    ctx.beginPath(); ctx.rect(x, y, size, size); ctx.clip();
    ctx.globalAlpha = 0.9; ctx.drawImage(this.miniCache, x, y, size, size); ctx.globalAlpha = 1;
    const map = (wx, wz) => [x + ((wx + Wd.half) / Wd.size) * size, y + ((wz + Wd.half) / Wd.size) * size];
    const sc = size / Wd.size;
    for (const s of g.smokes) { const [mx, my] = map(s.x, s.z); ctx.fillStyle = 'rgba(230,230,230,0.6)'; ctx.beginPath(); ctx.arc(mx, my, s.r * sc, 0, 7); ctx.fill(); }
    for (const s of g.strikes) if (s.t > -0.5) { const [mx, my] = map(s.x, s.z); ctx.strokeStyle = '#ff3b30'; ctx.lineWidth = 2; ctx.fillStyle = 'rgba(255,60,40,0.25)'; ctx.beginPath(); ctx.arc(mx, my, s.r * sc, 0, 7); ctx.fill(); ctx.stroke(); }
    for (const p of g.pickups) {
      if (!p.active) continue;
      const [mx, my] = map(p.x, p.z);
      ctx.fillStyle = p.kind === 'health' ? '#ff5a5a' : p.kind === 'ammo' ? '#ffd84d' : p.kind === 'weapon' ? '#ff9a3c' : '#c873ff';
      ctx.fillRect(mx - 2, my - 2, 4, 4);
    }
    for (const d of g.drops) { const [mx, my] = map(d.x, d.z); ctx.strokeStyle = '#ffd84d'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(mx, my, 5 + Math.sin(g.time * 6) * 2, 0, 7); ctx.stroke(); }
    for (const t of g.tanks.values()) {
      if (!t.net.al || (t.net.pw.ghost && t !== me)) continue;
      const [mx, my] = map(t.x, t.z);
      ctx.save(); ctx.translate(mx, my); ctx.rotate(-t.yaw + Math.PI);
      ctx.fillStyle = t.css; ctx.strokeStyle = t === me ? '#fff' : '#000'; ctx.lineWidth = t === me ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4.5, 5); ctx.lineTo(-4.5, 5); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
    this.roundRect(x - 3, y - 3, size + 6, size + 6, 10, null, 'rgba(255,255,255,0.5)');
  }

  // ---------- global ----------
  drawScoreboard(W) {
    const g = this.g;
    const list = [...g.tanks.values()];
    const pw = 104, gap = 8, tw = list.length * (pw + gap) + 90;
    const x0 = W / 2 - tw / 2;
    this.roundRect(x0, 8, tw, 44, 14, 'rgba(15,20,35,0.6)');
    list.forEach((t, i) => {
      const x = x0 + 10 + i * (pw + gap);
      this.roundRect(x, 14, pw, 32, 10, t.net.al ? t.css : 'rgba(80,80,80,0.8)', t.id === g.you ? '#fff' : null);
      this.label(x + 8, 30, (t.net.h ? '' : '🤖') + t.net.name.replace(' (bot)', '').slice(0, 8), 12, '#fff', 'left', 'middle', FONT, 'rgba(0,0,0,0.6)');
      this.label(x + pw - 8, 30, g.cfg.lives > 0 ? `${t.net.s}·♥${Math.max(0, t.net.l)}` : `${t.net.s}`, 17, '#fff', 'right', 'middle', FONT, 'rgba(0,0,0,0.6)');
    });
    const s = g.snap;
    if (!s) return;
    const tx = x0 + tw - 44;
    const tt = g.cfg.timeLimit > 0 ? Math.max(0, g.cfg.timeLimit - s.mt) : s.mt;
    this.label(tx, 24, `${Math.floor(tt / 60)}:${Math.floor(tt % 60).toString().padStart(2, '0')}`, 16, tt < 30 && g.cfg.timeLimit > 0 ? '#ff7070' : '#fff', 'center');
    this.label(tx, 41, g.cfg.lives > 0 ? 'LIVES' : `TO ${g.cfg.scoreLimit}`, 9, '#bcd', 'center');
  }

  drawKillfeed(W) {
    const g = this.g;
    g.killfeed.forEach((k, i) => {
      const y = 70 + i * 24;
      this.ctx.globalAlpha = k.t > 5 ? 1 - (k.t - 5) : 1;
      const icon = KILL_ICONS[k.w] || '💥';
      const a = k.a.replace(' (bot)', ''), b = k.b.replace(' (bot)', '');
      if (k.self) this.label(W - 14, y, `${a} ${icon} ${b}`, 13, k.ac, 'right');
      else {
        this.ctx.font = `bold 13px ${FONT}`;
        const bw = this.ctx.measureText(b).width;
        this.label(W - 14, y, b, 13, k.bc, 'right');
        this.label(W - 20 - bw, y, icon, 13, '#fff', 'right');
        this.label(W - 44 - bw, y, a, 13, k.ac, 'right');
      }
      this.ctx.globalAlpha = 1;
    });
  }

  drawAnnouncements(W, H) {
    const g = this.g, ctx = this.ctx;
    g.announce.slice(-1).forEach((a, i) => {
      const t = a.t;
      const pop = t < 0.2 ? 0.5 + t * 3 : 1.1 - Math.min(0.1, (t - 0.2) * 0.5);
      ctx.save();
      ctx.globalAlpha = t > 1.7 ? Math.max(0, 1 - (t - 1.7) * 2) : 1;
      ctx.translate(W / 2, H * 0.26 + i * 56);
      ctx.scale(pop, pop);
      ctx.rotate(Math.sin(t * 6) * 0.03);
      const size = a.big ? 96 : 40;
      ctx.font = `900 ${size}px ${COMIC}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      ctx.lineWidth = size / 4; ctx.strokeStyle = '#2a1033'; ctx.strokeText(a.text, 0, 0);
      ctx.lineWidth = size / 10; ctx.strokeStyle = '#fff'; ctx.strokeText(a.text, 0, 0);
      ctx.fillStyle = a.col || '#ffdd33'; ctx.fillText(a.text, 0, 0);
      ctx.restore();
    });
  }

  drawCountdown(W, H) {
    const g = this.g, ctx = this.ctx;
    const cd = g.snap ? g.snap.cd : 0;
    const c = Math.ceil(cd - 0.5);
    if (c >= 1 && c <= 3) {
      const f = (cd - 0.5) % 1;
      ctx.save(); ctx.translate(W / 2, H * 0.4); const s = 1 + f * 0.6; ctx.scale(s, s);
      ctx.font = `900 120px ${COMIC}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 22; ctx.strokeStyle = '#2a1033'; ctx.strokeText(c, 0, 0);
      ctx.lineWidth = 8; ctx.strokeStyle = '#fff'; ctx.strokeText(c, 0, 0);
      ctx.fillStyle = ['#59e666', '#ffd133', '#ff5247'][c - 1]; ctx.fillText(c, 0, 0);
      ctx.restore();
    }
    this.controlsCard(W / 2, H - 200, 0.85);
  }

  controlsCard(cx, cy, k = 1) {
    const rows = CONTROLS_HELP;
    const w = 800 * k, lh = 20 * k, h = Math.ceil(rows.length / 2) * lh + 20 * k;
    this.roundRect(cx - w / 2, cy - h / 2, w, h, 12, 'rgba(10,15,30,0.7)');
    rows.forEach(([key, what], i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const x = cx - w / 2 + 14 * k + col * (w / 2), y = cy - h / 2 + 18 * k + row * lh;
      this.label(x, y, key, 12 * k, '#ffdd33', 'left');
      this.label(x + 76 * k, y, what, 11 * k, '#e8eeff', 'left');
    });
  }

  drawHelp(W, H) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(10,15,30,0.72)'; ctx.fillRect(0, 0, W, H);
    this.label(W / 2, H * 0.12, 'HOW TO PLAY', 56, '#ffdd33', 'center', 'middle', COMIC, '#2a1033');
    this.controlsCard(W / 2, H * 0.33, 1.2);
    const tips = [
      'Standard: the all-purpose shell · High Velocity: flat, fast, hits like a truck (few rounds)',
      'Heat Seeker: lock a tank in COMMANDER view, or hold several in the bird\'s-eye circle for a salvo; it arcs high and dives — trees and smoke protect you',
      'MASSIVE: one shell, one mushroom cloud. Do not stand near it.',
      'Cluster: bursts above the target into a ring of bomblets',
      'Flamethrower: brutal up close, but watch HEAT — your own fuel can catch fire',
      'Rapid Fire: shreds, but the barrel climbs and wanders — fire in bursts',
      'Air Strike: marks a zone everyone can see; bombers flatten it 5 s later (20 s cooldown)',
      'Smoke (G): breaks locks and line of sight · Red barrels explode!',
    ];
    tips.forEach((t, i) => this.label(W / 2, H * 0.56 + i * 24, t, 13, '#cfe', 'center'));
    this.label(W / 2, H * 0.56 + tips.length * 24 + 20, 'Esc to close — the battle keeps going while this is open!', 13, '#ffb070', 'center');
  }

  drawGameOver(W, H) {
    const g = this.g, ctx = this.ctx;
    const k = Math.min(1, (g.overT || 0) * 1.5);
    ctx.fillStyle = `rgba(10,15,30,${0.35 * k})`; ctx.fillRect(0, 0, W, H);
    const s = g.snap;
    const w = s && s.win >= 0 ? g.tanks.get(s.win) : null;
    if (!this.confetti || this.confettiFor !== s.win) {
      this.confettiFor = s.win;
      const cols = ['#ff5247', '#4d8cff', '#ffd133', '#59e666', '#ff7ad9', '#ffffff'];
      this.confetti = Array.from({ length: 160 }, () => ({ x: Math.random() * W, y: -Math.random() * H, vy: 60 + Math.random() * 90, sw: Math.random() * 6, r: Math.random() * 6, c: cols[Math.floor(Math.random() * cols.length)], s: 5 + Math.random() * 6 }));
    }
    for (const c of this.confetti) {
      c.y += c.vy / 60; c.sw += 0.05; c.r += 0.07;
      if (c.y > H + 10) { c.y = -10; c.x = Math.random() * W; }
      ctx.save(); ctx.translate(c.x + Math.sin(c.sw) * 14, c.y); ctx.rotate(c.r);
      ctx.fillStyle = c.c; ctx.fillRect(-c.s / 2, -c.s / 4, c.s, c.s / 2);
      ctx.restore();
    }
    const ty0 = H * 0.12;
    ctx.save(); ctx.translate(W / 2, ty0);
    const sc = 0.6 + 0.4 * k + Math.sin(g.realTime * 3) * 0.03; ctx.scale(sc, sc);
    this.label(0, 0, w ? `${w.net.name.replace(' (bot)', '')} WINS!` : 'DRAW!', 78, w ? w.css : '#fff', 'center', 'middle', COMIC, '#2a1033');
    ctx.restore();
    this.label(W / 2, ty0 + 52, s.why || '', 16, '#fff', 'center');
    const rows = [...g.tanks.values()].sort((a, b) => b.net.s - a.net.s || a.net.d - b.net.d);
    const tx = W / 2 - 220, ty = H - 80 - rows.length * 34;
    this.roundRect(tx - 10, ty - 30, 460, 40 + rows.length * 34, 14, 'rgba(15,20,35,0.75)');
    [['PLAYER', 0], ['VEHICLE', 200], ['KILLS', 320], ['DEATHS', 380]].forEach(([c, x]) => this.label(tx + x, ty - 10, c, 11, '#9ab', 'left'));
    rows.forEach((t, i) => {
      const y = ty + 18 + i * 34;
      this.label(tx, y, `${i === 0 && w ? '🏆 ' : ''}${t.net.name}`, 15, t.css, 'left');
      this.label(tx + 200, y, t.def.name, 13, '#fff', 'left');
      this.label(tx + 320, y, String(t.net.k), 14, '#fff', 'left');
      this.label(tx + 380, y, String(t.net.d), 14, '#fff', 'left');
    });
    // intermission: everyone can pick (or change) their vehicle for the next round
    const y0 = ty0 + 80, ch = 180;
    this.seatCards(W, y0, ch, true);
    const blink = Math.floor(g.realTime * 2.5) % 2 === 0;
    const secs = s.it >= 0 ? ` in ${s.it}s` : ' soon';
    this.label(W / 2, y0 + ch + 26, g.you >= 0 ? '←/→ choose vehicle for the next round · SPACE ready · ENTER start now' : 'You are spectating', 18, blink ? '#ffdd33' : '#fff', 'center', 'middle', COMIC);
    this.label(W / 2, y0 + ch + 50, `Next round starts${secs}, or when everyone is ready.`, 13, '#dde', 'center');
  }

  // ---------- network lobby ----------
  drawLobby(W, H) {
    const g = this.g, ctx = this.ctx, t = g.realTime;
    ctx.save(); ctx.translate(W / 2, H * 0.12); ctx.rotate(Math.sin(t * 1.3) * 0.02);
    const title = 'MICRO BATTLE';
    ctx.font = `900 ${Math.min(104, W / 9)}px ${COMIC}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    const total = ctx.measureText(title).width;
    let x = -total / 2;
    const cols = ['#ff5247', '#ffd133', '#4d8cff', '#59e666'];
    title.split('').forEach((ch, i) => {
      const w = ctx.measureText(ch).width, y = Math.sin(t * 3 + i * 0.5) * 8;
      ctx.lineWidth = 18; ctx.strokeStyle = '#2a1033'; ctx.strokeText(ch, x + w / 2, y);
      ctx.lineWidth = 6; ctx.strokeStyle = '#fff'; ctx.strokeText(ch, x + w / 2, y);
      ctx.fillStyle = cols[i % 4]; ctx.fillText(ch, x + w / 2, y);
      x += w;
    });
    ctx.restore();
    const cfg = g.cfg || {};
    const modeTxt = cfg.mode === 'any' ? 'any view (C to switch)' : (VIEW_NAMES[cfg.mode] || '') + ' view';
    this.label(W / 2, H * 0.12 + 62, `NETWORK BATTLE · ${modeTxt} · first to ${cfg.scoreLimit} · ${cfg.difficulty} bots`, 15, '#fff', 'center');
    this.label(W / 2, H * 0.12 + 86, `Friends join by opening this page from your machine's network address (port ${location.port || 80})`, 13, '#cfe', 'center');
    const ch = 290, y0 = H * 0.3;
    this.seatCards(W, y0, ch, false);
    const blink = Math.floor(t * 2.5) % 2 === 0;
    this.label(W / 2, y0 + ch + 40, g.you >= 0 ? '←/→ choose vehicle · SPACE ready · ENTER start now · N rename' : 'The battle is full — you are spectating', 18, blink ? '#ffdd33' : '#fff', 'center', 'middle', COMIC);
    this.label(W / 2, y0 + ch + 70, 'Starts when everyone is ready (or anyone presses ENTER). Empty seats are bots.', 13, '#dde', 'center');
    if (g.snap && g.snap.lt >= 0) this.label(W / 2, y0 + ch + 92, `auto-start in ${g.snap.lt}s`, 13, '#ccd', 'center');
  }

  /** One card per seat: name, vehicle (with ◀ ▶ on your own), loadout and ready state. Compact for the intermission. */
  seatCards(W, y0, ch, compact) {
    const g = this.g, t = g.realTime;
    const cw = Math.min(250, (W - 80) / 4), gap = 16;
    const x0 = W / 2 - (cw * 4 + gap * 3) / 2;
    for (let i = 0; i < 4; i++) {
      const p = g.lobby.players.find((q) => q.slot === i);
      const mine = i === g.you;
      const col = PLAYER_COLORS[i];
      const cx = x0 + i * (cw + gap);
      const bob = p ? Math.sin(t * 4 + i) * 3 : 0;
      this.roundRect(cx, y0 + bob, cw, ch, 18, p ? 'rgba(20,25,45,0.85)' : 'rgba(20,25,45,0.5)', mine ? '#fff' : col.css);
      this.roundRect(cx, y0 + bob, cw, 40, 18, col.css);
      this.label(cx + cw / 2, y0 + bob + 21, mine ? 'YOU' : `SEAT ${i + 1}`, 20, '#fff', 'center', 'middle', COMIC, 'rgba(0,0,0,0.4)');
      if (!p) {
        this.label(cx + cw / 2, y0 + ch * 0.41, 'BOT', compact ? 32 : 42, 'rgba(255,255,255,0.35)', 'center', 'middle', COMIC);
        this.label(cx + cw / 2, y0 + ch * 0.62, compact ? 'picks a random vehicle' : 'open seat', 13, '#ccd', 'center');
        if (!compact) this.label(cx + cw / 2, y0 + 200, 'a bot drives until someone joins', 11, '#99a', 'center');
        continue;
      }
      const def = TANK_TYPES[mine ? g.type : p.type];
      this.label(cx + cw / 2, y0 + bob + 60, p.name, 16, '#fff', 'center');
      if (mine) { this.label(cx + 16, y0 + bob + 92, '◀', 22, '#fff', 'left'); this.label(cx + cw - 16, y0 + bob + 92, '▶', 22, '#fff', 'right'); }
      this.label(cx + cw / 2, y0 + bob + 92, def.name.toUpperCase(), def.name.length > 9 ? 21 : 26, col.css, 'center', 'middle', COMIC);
      this.label(cx + cw / 2, y0 + bob + 116, def.blurb, 11, '#cde', 'center', 'middle', FONT, null);
      if (compact) {
        this.label(cx + cw / 2, y0 + bob + 140, def.weapons.map((w) => WEAPONS[w].short).join(' · '), 11, '#ffe08a', 'center');
        this.label(cx + cw / 2, y0 + bob + ch - 22, p.ready ? '✔ READY' : 'not ready', 16, p.ready ? '#7dff8a' : '#99a', 'center');
        continue;
      }
      const stats = [['SPEED', def.speed / 24], ['ARMOR', def.hp / def.armor / 270], ['TURRET', def.turret / 4], ['ELEVATION', def.pitchMax / 1.3]];
      stats.forEach(([n, val], k) => {
        const yy = y0 + bob + 142 + k * 20;
        this.label(cx + 16, yy, n, 10, '#abc', 'left');
        this.bar(cx + 92, yy - 5, cw - 108, 10, val, col.css);
      });
      this.label(cx + cw / 2, y0 + bob + 232, def.weapons.map((w) => WEAPONS[w].short).join(' · '), 11, '#ffe08a', 'center');
      this.label(cx + cw / 2, y0 + bob + 262, p.ready ? '✔ READY' : 'not ready', 16, p.ready ? '#7dff8a' : '#99a', 'center');
    }
  }
}

function hpCol(f) { return f > 0.6 ? '#5be36b' : f > 0.3 ? '#ffd133' : '#ff4f4f'; }
