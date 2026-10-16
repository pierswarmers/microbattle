// 2D overlay: lobby, scoreboard, player panels, gunner scope, minimap, labels, comic pop-text, menus.
import { TANK_TYPES, TANK_ORDER, WEAPONS, POWERUPS, PLAYER_COLORS } from './defs.js';
import { KEYMAPS } from './input.js';
import { m4, clamp, wrapAngle } from './math.js';

const FONT = '"Arial Rounded MT Bold", "Trebuchet MS", "Verdana", sans-serif';
const COMIC = 'Impact, "Arial Black", "Haettenschweiler", sans-serif';
const JOIN_KEYS = ['SPACE', 'N', 'ENTER', 'GAMEPAD A'];

export class HUD {
  constructor(canvas, game) {
    this.c = canvas;
    this.g = game;
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

  draw(views, dt) {
    const ctx = this.ctx, g = this.g;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const W = this.c.clientWidth, H = this.c.clientHeight;
    ctx.clearRect(0, 0, W, H);
    if (g.state === 'lobby') { this.drawLobby(W, H); return; }
    for (const v of views) {
      ctx.save();
      ctx.beginPath(); ctx.rect(v.x, v.y, v.w, v.h); ctx.clip();
      this.drawWorldLabels(v);
      if (v.kind === 'commander') this.drawScope(v);
      if (v.kind === 'overview') this.label(v.x + v.w / 2, v.y + 22, 'BATTLEFIELD OVERVIEW', 14, '#fff', 'center');
      if (v.tank && (v.kind === 'commander' || views.length > 1 || g.cfg.split)) this.drawPanel(v.tank, v.x + 12, v.y + v.h - 12, 'bl', v);
      if (v.tank && v.kind === 'commander') this.drawMinimap(v.x + v.w - 12, v.y + v.h - 12, Math.min(150, v.w * (views.length > 1 ? 0.15 : 0.22)), v.tank);
      if (v.tank && !v.tank.alive) this.drawDeadNotice(v);
      ctx.restore();
      if (views.length > 1) { ctx.strokeStyle = 'rgba(20,20,30,0.9)'; ctx.lineWidth = 3; ctx.strokeRect(v.x, v.y, v.w, v.h); }
    }
    const shared = views.length === 1 && views[0].kind === 'birds' && !g.cfg.split && g.humans.length > 0;
    if (shared) {
      const corners = ['bl', 'br', 'tl', 'tr'];
      g.humans.forEach((t, i) => {
        const c = corners[i];
        const x = c[1] === 'l' ? 12 : W - 12, y = c[0] === 'b' ? H - 12 : 70;
        this.drawPanel(t, x, y, c, views[0]);
      });
      this.drawOffscreen(views[0]);
      if (g.humans.length === 0) this.label(W / 2, H - 20, 'SPECTATING — ALL BOTS', 14, 'rgba(255,255,255,0.8)', 'center');
      this.drawMinimap(W - 12, H - 12 - (g.humans.length > 1 ? 150 : 0), 150, null);
    }
    this.drawScoreboard(W);
    this.drawKillfeed(W);
    this.drawAnnouncements(W, H);
    if (g.state === 'countdown') this.drawCountdown(W, H);
    if (g.state === 'paused') this.drawPause(W, H);
    if (g.state === 'over') this.drawGameOver(W, H);
    if (g.cfg.debug || g.cfg.fps) this.label(8, H - 8, `${g.fps.toFixed(0)} fps · ${g.fx.parts.length} particles · ${g.projectiles.length} proj`, 12, '#fff', 'left', 'bottom');
    if (!g.audioStarted && g.state === 'countdown') this.label(W / 2, H * 0.55, '🔊 press any key or click to enable sound', 13, 'rgba(255,255,255,0.85)', 'center');
  }

  // ---------- primitives ----------
  label(x, y, text, size, col, align = 'left', base = 'middle', font = FONT, stroke = 'rgba(0,0,0,0.75)') {
    const ctx = this.ctx;
    ctx.font = `bold ${size}px ${font}`;
    ctx.textAlign = align;
    ctx.textBaseline = base;
    if (stroke) { ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(2, size / 5); ctx.strokeStyle = stroke; ctx.strokeText(text, x, y); }
    ctx.fillStyle = col;
    ctx.fillText(text, x, y);
  }

  roundRect(x, y, w, h, r, fill, stroke) {
    const ctx = this.ctx;
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

  // ---------- in-world labels ----------
  drawWorldLabels(v) {
    const g = this.g, ctx = this.ctx;
    const birds = v.kind === 'birds' || v.kind === 'overview';
    for (const t of g.tanks) {
      if (!t.alive) continue;
      if (v.tank === t && !birds) continue;
      if (t.power.ghost > 0 && !(v.tank === t)) continue;
      const p = this.project(v, t.x, t.y + 3.4 * t.scale, t.z);
      if (!p || p.nx < -1.1 || p.nx > 1.1 || p.ny < -1.1 || p.ny > 1.1) continue;
      const dist = p.w;
      if (!birds && dist > 260) continue;
      const k = birds ? 1 : clamp(60 / dist, 0.55, 1);
      const w = 46 * k;
      if (!birds) {
        // enemy marker for the gunner
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.PI / 4);
        ctx.strokeStyle = t.css; ctx.lineWidth = 2;
        ctx.strokeRect(-6 * k, -6 * k, 12 * k, 12 * k);
        ctx.restore();
        this.label(p.x, p.y - 16 * k, `${t.name.replace(' (bot)', '')} ${Math.round(dist)}m`, 11 * k + 2, t.css, 'center');
        this.bar(p.x - w / 2, p.y - 30 * k, w, 5, t.hp / t.maxHp, hpCol(t.hp / t.maxHp));
      } else {
        this.label(p.x, p.y - 12, t.name.replace(' (bot)', ''), 12, t.css, 'center');
        this.bar(p.x - w / 2, p.y - 4, w, 6, t.hp / t.maxHp, hpCol(t.hp / t.maxHp));
        if (t.shieldHp > 0) this.bar(p.x - w / 2, p.y + 4, w * (t.shieldHp / POWERUPS.shield.absorb), 3, 1, '#8899ff');
        if (t.human && t.mouseAim && t.mouseTarget && t.slot === 0) {
          const q = this.project(v, t.mouseTarget[0], t.mouseTarget[1], t.mouseTarget[2]);
          if (q) this.crosshair(q.x, q.y, t.css);
        }
      }
    }
    // pop text (comic book style)
    for (const tx of g.fx.texts) {
      const p = this.project(v, tx.x, tx.y, tx.z);
      if (!p || p.w > 300) continue;
      const a = tx.age / tx.life;
      const pop = a < 0.15 ? 0.4 + (a / 0.15) * 0.9 : a < 0.25 ? 1.3 - ((a - 0.15) / 0.1) * 0.3 : 1;
      const base = tx.small ? 16 : 34;
      const size = base * tx.scale * pop * (birds ? 1 : clamp(50 / p.w, 0.5, 1.6));
      ctx.save();
      ctx.globalAlpha = a > 0.7 ? 1 - (a - 0.7) / 0.3 : 1;
      ctx.translate(p.x, p.y);
      ctx.rotate(tx.rot);
      ctx.font = `${size}px ${COMIC}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      if (!tx.small) { ctx.lineWidth = size / 3.5; ctx.strokeStyle = '#2a1033'; ctx.strokeText(tx.text, 0, 0); }
      ctx.lineWidth = size / 8; ctx.strokeStyle = tx.small ? '#000' : '#fff'; ctx.strokeText(tx.text, 0, 0);
      ctx.fillStyle = tx.col; ctx.fillText(tx.text, 0, 0);
      ctx.restore();
    }
    // pickup icons from above
    if (birds && v.kind !== 'overview') for (const p of g.pickups) {
      if (!p.active) continue;
      const q = this.project(v, p.x, p.y + 4.2, p.z);
      if (!q || Math.abs(q.nx) > 1 || Math.abs(q.ny) > 1) continue;
      const icon = p.kind === 'health' ? '❤️' : p.kind === 'ammo' ? '🧨' : p.kind === 'weapon' ? '🔫' : { speed: '⚡', shield: '🛡️', damage: '💪', rapid: '🔥', ghost: '👻' }[p.sub];
      ctx.font = '16px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(icon, q.x, q.y + Math.sin(p.spin * 2.2) * 3);
    }
    // airdrop markers
    for (const d of g.drops) {
      const p = this.project(v, d.x, d.y + 9, d.z);
      if (p && p.nx > -1 && p.nx < 1 && p.ny > -1 && p.ny < 1) this.label(p.x, p.y, '📦 SUPPLY DROP', 12, '#ffd84d', 'center');
    }
  }

  crosshair(x, y, col) {
    const ctx = this.ctx;
    ctx.strokeStyle = col; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 15, y); ctx.lineTo(x - 5, y); ctx.moveTo(x + 5, y); ctx.lineTo(x + 15, y); ctx.moveTo(x, y - 15); ctx.lineTo(x, y - 5); ctx.moveTo(x, y + 5); ctx.lineTo(x, y + 15); ctx.stroke();
  }

  drawOffscreen(v) {
    const g = this.g, ctx = this.ctx;
    for (const t of g.humans) {
      if (!t.alive) continue;
      const p = this.project(v, t.x, t.y + 1, t.z);
      if (p && Math.abs(p.nx) < 0.95 && Math.abs(p.ny) < 0.95) continue;
      const cx = v.x + v.w / 2, cy = v.y + v.h / 2;
      let dx = p ? p.x - cx : 0, dy = p ? p.y - cy : -1;
      const a = Math.atan2(dy, dx);
      const rx = v.w / 2 - 30, ry = v.h / 2 - 30;
      const s = Math.min(Math.abs(rx / Math.cos(a)), Math.abs(ry / Math.sin(a)));
      const x = cx + Math.cos(a) * s, y = cy + Math.sin(a) * s;
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      ctx.fillStyle = t.css; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-8, -11); ctx.lineTo(-8, 11); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
      this.label(x, y + 20, t.name, 12, t.css, 'center');
    }
  }

  // ---------- gunner scope ----------
  drawScope(v) {
    const g = this.g, ctx = this.ctx, t = v.tank;
    if (!t.alive) return;
    const cx = v.x + v.w / 2, cy = v.y + v.h / 2;
    const R = Math.min(v.w, v.h) * 0.45;
    const W = WEAPONS[t.weapons[t.wi].id];
    // vignette mask
    ctx.save();
    ctx.beginPath();
    ctx.rect(v.x, v.y, v.w, v.h);
    ctx.arc(cx, cy, R, 0, Math.PI * 2, true);
    ctx.fillStyle = 'rgba(14,18,24,0.88)';
    ctx.fill('evenodd');
    const grad = ctx.createRadialGradient(cx, cy, R * 0.7, cx, cy, R * 1.05);
    grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = t.css; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    // reticle
    const col = 'rgba(255,255,255,0.92)';
    const kick = t.camKick * 30;
    const ry = cy;
    ctx.strokeStyle = col; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - R * 0.95, ry); ctx.lineTo(cx - 26, ry);
    ctx.moveTo(cx + 26, ry); ctx.lineTo(cx + R * 0.95, ry);
    ctx.moveTo(cx, ry + 26); ctx.lineTo(cx, ry + R * 0.7);
    ctx.stroke();
    // chevron
    ctx.strokeStyle = t.css; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cx - 14, ry + 14 + kick * 0.2); ctx.lineTo(cx, ry); ctx.lineTo(cx + 14, ry + 14 + kick * 0.2); ctx.stroke();
    // stadia ticks
    ctx.strokeStyle = col; ctx.lineWidth = 1.5;
    for (let i = 1; i <= 6; i++) {
      const d = i * R * 0.13;
      ctx.beginPath(); ctx.moveTo(cx - d, ry - 6); ctx.lineTo(cx - d, ry + 6); ctx.moveTo(cx + d, ry - 6); ctx.lineTo(cx + d, ry + 6); ctx.stroke();
    }
    for (let i = 1; i <= 4; i++) {
      const d = i * R * 0.14;
      ctx.beginPath(); ctx.moveTo(cx - 8 + i, ry + d); ctx.lineTo(cx + 8 - i, ry + d); ctx.stroke();
    }
    // aim marker: where the turret is slewing to (mouse-look / fast traverse)
    const dYaw = wrapAngle(t.aimYaw - t.turretYaw);
    if (Math.abs(dYaw) > 0.03 || Math.abs(t.aimPitch - t.pitch) > 0.02) {
      const sxp = t.muzzle[0] + Math.sin(t.aimYaw) * 80, syp = t.muzzle[1] + Math.tan(t.aimPitch) * 80, szp = t.muzzle[2] + Math.cos(t.aimYaw) * 80;
      const q = this.project(v, sxp, syp, szp);
      ctx.strokeStyle = 'rgba(255,230,120,0.9)'; ctx.lineWidth = 2;
      if (q && Math.abs(q.nx) < 1 && Math.abs(q.ny) < 1) { ctx.beginPath(); ctx.arc(q.x, q.y, 7, 0, Math.PI * 2); ctx.stroke(); }
      else { const a = -Math.sign(dYaw); ctx.beginPath(); ctx.moveTo(cx + a * (R - 14), ry - 10); ctx.lineTo(cx + a * (R - 2), ry); ctx.lineTo(cx + a * (R - 14), ry + 10); ctx.stroke(); }
    }
    // reload arc
    const rel = clamp(1 - t.cooldown / (W.reload * (t.power.rapid > 0 ? 0.5 : 1)), 0, 1);
    ctx.strokeStyle = rel >= 1 ? 'rgba(120,255,140,0.9)' : 'rgba(255,200,80,0.9)'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(cx, ry, 38, -Math.PI / 2, -Math.PI / 2 + rel * Math.PI * 2); ctx.stroke();
    // hit marker
    if (t.hitMarkT > 0) {
      ctx.strokeStyle = `rgba(255,80,60,${t.hitMarkT * 4})`; ctx.lineWidth = 3;
      ctx.beginPath(); for (const [a, b] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { ctx.moveTo(cx + a * 10, ry + b * 10); ctx.lineTo(cx + a * 22, ry + b * 22); } ctx.stroke();
    }
    // range readout
    let range = null;
    if (W.kind === 'lob' && v.impact) range = Math.hypot(v.impact[0] - t.x, v.impact[2] - t.z);
    else {
      for (let s = 2; s < 400 && range === null; s += 1.5) {
        const x = t.muzzle[0] + t.dir[0] * s, y = t.muzzle[1] + t.dir[1] * s, z = t.muzzle[2] + t.dir[2] * s;
        if (y < g.world.heightAt(x, z)) { range = s; break; }
        g.world.query(x, z, 0.3, (o) => { if (y < o.top) { range = s; return false; } });
        for (const e of g.tanks) if (e !== t && e.alive && Math.hypot(e.x - x, e.z - z) < e.radius && y < e.y + 2.6) range = s;
        for (const p of g.pickups) if (p.active && Math.hypot(p.x - x, p.z - z) < 1.2 && y < p.y + 2.6) range = s;
      }
    }
    this.label(cx + 50, ry + 22, range ? `RNG ${Math.round(range)}m` : 'RNG ---', 13, '#bfffd0', 'left');
    this.label(cx + 50, ry + 40, `ELV ${(t.pitch * 57.3).toFixed(1)}°`, 12, '#bfffd0', 'left');
    if (t.zoom) this.label(cx + 50, ry - 22, `ZOOM ${t.def.zoom}x`, 13, '#ffe08a', 'left');
    // compass tape
    const heading = ((-t.turretYaw * 180) / Math.PI + 180 + 3600) % 360;
    const tapeW = Math.min(v.w * 0.5, 360), tx = cx - tapeW / 2, ty = v.y + (v.y < 60 ? 76 : 22);
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
    ctx.fillStyle = t.css; ctx.beginPath(); ctx.moveTo(cx, ty + 14); ctx.lineTo(cx - 6, ty + 22); ctx.lineTo(cx + 6, ty + 22); ctx.fill();
    // hull vs turret indicator
    const ix = cx, iy = v.y + v.h - 46;
    ctx.save(); ctx.translate(ix, iy);
    ctx.rotate(-(t.yaw - t.turretYaw));
    this.roundRect(-11, -16, 22, 32, 4, 'rgba(0,0,0,0.4)', t.css);
    ctx.fillStyle = t.css; ctx.fillRect(-11, -18, 22, 4);
    ctx.restore();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(ix, iy); ctx.lineTo(ix, iy - 26); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ix, iy, 6, 0, Math.PI * 2); ctx.fill();
    this.label(ix, iy + 28, 'HULL', 9, 'rgba(255,255,255,0.7)', 'center');
    // damage direction
    if (t.dmgT > 0 && t.dmgDir !== null) {
      const a = wrapAngle(t.dmgDir - t.turretYaw);
      ctx.strokeStyle = `rgba(255,40,30,${t.dmgT * 0.8})`; ctx.lineWidth = 10;
      ctx.beginPath(); ctx.arc(cx, ry, R * 0.55, -Math.PI / 2 - a - 0.3, -Math.PI / 2 - a + 0.3); ctx.stroke();
    }
  }

  drawDeadNotice(v) {
    const t = v.tank, cx = v.x + v.w / 2, cy = v.y + v.h * 0.35;
    if (t.eliminated) { this.label(cx, cy, 'ELIMINATED', 40, '#ff5a5a', 'center', 'middle', COMIC); return; }
    this.label(cx, cy, 'DESTROYED!', 44, '#ff7a3a', 'center', 'middle', COMIC);
    this.label(cx, cy + 40, `respawning in ${Math.max(0, t.respawnT).toFixed(1)}s`, 16, '#fff', 'center');
  }

  // ---------- player panel ----------
  drawPanel(t, x, y, corner, v) {
    const ctx = this.ctx;
    if (v && v.h < 420 && !t.human) {
      // compact badge for spectator quadrants so tanks stay visible
      const w = 170, px = x, py = y - 34;
      this.roundRect(px, py, w, 30, 10, 'rgba(15,20,35,0.6)', t.css);
      this.label(px + 10, py + 10, t.name.replace(' (bot)', '') + ' · ' + t.def.name, 11, t.css, 'left');
      if (t.alive) this.bar(px + 10, py + 19, w - 20, 6, t.hp / t.maxHp, hpCol(t.hp / t.maxHp));
      return;
    }
    const w = 230, h = 92 + Math.max(0, t.weapons.length - 2) * 0;
    const px = corner[1] === 'l' ? x : x - w;
    const py = corner[0] === 'b' ? y - h : y;
    this.roundRect(px, py, w, h, 12, 'rgba(15,20,35,0.62)', t.css);
    this.label(px + 12, py + 15, t.name.replace(' (bot)', '') + (t.human ? '' : ' 🤖'), 15, t.css, 'left');
    this.label(px + w - 12, py + 15, `${t.def.name.toUpperCase()} · ${t.def.role}`, 11, '#dfe6ff', 'right');
    if (t.alive) {
      this.bar(px + 12, py + 28, w - 24, 12, t.hp / t.maxHp, hpCol(t.hp / t.maxHp));
      this.label(px + w / 2, py + 34, `${Math.ceil(t.hp)} / ${t.maxHp}`, 10, '#fff', 'center');
      if (t.shieldHp > 0) this.bar(px + 12, py + 42, (w - 24) * (t.shieldHp / POWERUPS.shield.absorb), 4, 1, '#8899ff');
    } else {
      this.label(px + w / 2, py + 34, t.eliminated ? 'ELIMINATED' : `RESPAWN ${Math.max(0, t.respawnT).toFixed(1)}s`, 13, '#ff8a6a', 'center');
    }
    // weapons
    let wx = px + 12;
    t.weapons.forEach((wp, i) => {
      const W = WEAPONS[wp.id];
      const sel = i === t.wi;
      const bw = Math.min(68, (w - 24) / t.weapons.length - 4);
      this.roundRect(wx, py + 50, bw, 34, 7, sel ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.35)', sel ? '#fff' : null);
      this.label(wx + bw / 2, py + 60, W.name.length > 9 ? W.name.split(' ')[0] : W.name, 10, sel ? '#fff' : '#aab', 'center');
      const reload = sel ? clamp(1 - t.cooldown / W.reload, 0, 1) : 1;
      this.label(wx + bw / 2, py + 75, `${wp.ammo}`, 13, wp.ammo > 0 ? (reload < 1 ? '#ffcf6a' : '#fff') : '#ff6a6a', 'center');
      wx += bw + 4;
    });
    // powerups
    let ix = px + 4;
    for (const k in t.power) {
      if (t.power[k] <= 0) continue;
      const P = POWERUPS[k];
      const by = corner[0] === 'b' ? py - 26 : py + h + 4;
      this.roundRect(ix, by, 80, 22, 11, 'rgba(0,0,0,0.55)', P.css);
      this.label(ix + 40, by + 11, `${P.name.split(' ')[0]} ${Math.ceil(t.power[k])}s`, 11, P.css, 'center');
      ix += 84;
    }
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
    ctx.globalAlpha = 0.9;
    ctx.drawImage(this.miniCache, x, y, size, size);
    ctx.globalAlpha = 1;
    const map = (wx, wz) => [x + ((wx + Wd.half) / Wd.size) * size, y + ((wz + Wd.half) / Wd.size) * size];
    for (const p of g.pickups) {
      if (!p.active) continue;
      const [mx, my] = map(p.x, p.z);
      ctx.fillStyle = p.kind === 'health' ? '#ff5a5a' : p.kind === 'ammo' ? '#ffd84d' : p.kind === 'weapon' ? '#ff9a3c' : '#c873ff';
      ctx.fillRect(mx - 2, my - 2, 4, 4);
    }
    for (const d of g.drops) { const [mx, my] = map(d.x, d.z); ctx.strokeStyle = '#ffd84d'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(mx, my, 5 + Math.sin(g.time * 6) * 2, 0, 7); ctx.stroke(); }
    for (const t of g.tanks) {
      if (!t.alive) continue;
      if (t.power.ghost > 0 && t !== me) continue;
      const [mx, my] = map(t.x, t.z);
      ctx.save(); ctx.translate(mx, my); ctx.rotate(-t.yaw + Math.PI);
      ctx.fillStyle = t.css; ctx.strokeStyle = t === me ? '#fff' : '#000'; ctx.lineWidth = t === me ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4.5, 5); ctx.lineTo(-4.5, 5); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    // view frustum for birds-eye camera
    ctx.restore();
    this.roundRect(x - 3, y - 3, size + 6, size + 6, 10, null, 'rgba(255,255,255,0.5)');
  }

  // ---------- global UI ----------
  drawScoreboard(W) {
    const g = this.g, ctx = this.ctx;
    const n = g.tanks.length;
    const pw = 92, gap = 8, tw = n * (pw + gap) + 90;
    const x0 = W / 2 - tw / 2;
    this.roundRect(x0, 8, tw, 44, 14, 'rgba(15,20,35,0.6)');
    g.tanks.forEach((t, i) => {
      const x = x0 + 10 + i * (pw + gap);
      this.roundRect(x, 14, pw, 32, 10, t.alive ? t.css : 'rgba(80,80,80,0.8)');
      this.label(x + 8, 30, t.name.replace(' (bot)', '').slice(0, 7), 12, '#fff', 'left', 'middle', FONT, 'rgba(0,0,0,0.6)');
      const s = g.cfg.lives > 0 ? `${t.score}·♥${Math.max(0, t.lives)}` : `${t.score}`;
      this.label(x + pw - 8, 30, s, 17, '#fff', 'right', 'middle', FONT, 'rgba(0,0,0,0.6)');
    });
    const tx = x0 + tw - 44;
    let tt = g.cfg.timeLimit > 0 ? Math.max(0, g.cfg.timeLimit - g.matchTime) : g.matchTime;
    const mm = Math.floor(tt / 60), ss = Math.floor(tt % 60);
    this.label(tx, 24, `${mm}:${ss.toString().padStart(2, '0')}`, 16, tt < 30 && g.cfg.timeLimit > 0 ? '#ff7070' : '#fff', 'center');
    this.label(tx, 41, g.cfg.lives > 0 ? 'LIVES' : `TO ${g.cfg.scoreLimit}`, 9, '#bcd', 'center');
  }

  drawKillfeed(W) {
    const g = this.g;
    g.killfeed.forEach((k, i) => {
      const y = 70 + i * 24;
      const a = k.t > 5 ? 1 - (k.t - 5) : 1;
      this.ctx.globalAlpha = a;
      const icon = { shell: '💥', bullet: '🔫', rocket: '🚀', lob: '💣', mine: '✴️', rail: '⚡', flame: '🔥', burn: '🔥', ram: '🐏', barrel: '🛢️', chain: '💥', blast: '💥' }[k.w] || '💥';
      const txt = k.self ? `${k.a} ${icon} ${k.b}` : null;
      if (txt) this.label(W - 14, y, txt, 13, k.ac, 'right');
      else {
        this.ctx.font = `bold 13px ${FONT}`;
        const bw = this.ctx.measureText(k.b).width;
        this.label(W - 14, y, k.b, 13, k.bc, 'right');
        this.label(W - 20 - bw, y, icon, 13, '#fff', 'right');
        this.label(W - 44 - bw, y, k.a, 13, k.ac, 'right');
      }
      this.ctx.globalAlpha = 1;
    });
  }

  drawAnnouncements(W, H) {
    const g = this.g, ctx = this.ctx;
    g.announce.slice(-2).forEach((a, i) => {
      const t = a.t;
      const pop = t < 0.2 ? 0.5 + t * 3 : 1.1 - Math.min(0.1, (t - 0.2) * 0.5);
      ctx.save();
      ctx.globalAlpha = t > 1.7 ? Math.max(0, 1 - (t - 1.7) * 2) : 1;
      ctx.translate(W / 2, H * 0.22 + i * 56);
      ctx.scale(pop, pop);
      ctx.rotate(Math.sin(t * 6) * 0.03);
      const size = a.big ? 96 : 40;
      ctx.font = `${size}px ${COMIC}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      ctx.lineWidth = size / 4; ctx.strokeStyle = '#2a1033'; ctx.strokeText(a.text, 0, 0);
      ctx.lineWidth = size / 10; ctx.strokeStyle = '#fff'; ctx.strokeText(a.text, 0, 0);
      ctx.fillStyle = a.col || '#ffdd33'; ctx.fillText(a.text, 0, 0);
      ctx.restore();
    });
  }

  drawCountdown(W, H) {
    const g = this.g, ctx = this.ctx;
    const c = Math.ceil(g.countdown - 0.5);
    if (c >= 1 && c <= 3) {
      const f = (g.countdown - 0.5) % 1;
      ctx.save();
      ctx.translate(W / 2, H * 0.4);
      const s = 1 + f * 0.6;
      ctx.scale(s, s);
      ctx.font = `120px ${COMIC}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 22; ctx.strokeStyle = '#2a1033'; ctx.strokeText(c, 0, 0);
      ctx.lineWidth = 8; ctx.strokeStyle = '#fff'; ctx.strokeText(c, 0, 0);
      ctx.fillStyle = ['#59e666', '#ffd133', '#ff5247'][c - 1]; ctx.fillText(c, 0, 0);
      ctx.restore();
    }
    // controls reminder
    const hs = g.humans;
    hs.forEach((t, i) => {
      const hy = H - 150 - (hs.length - 1 - i) * 30;
      this.roundRect(W / 2 - 330, hy - 12, 660, 26, 13, 'rgba(0,0,0,0.5)');
      this.label(W / 2, hy, `${t.name}: ${KEYMAPS[t.slot].help}${g.cfg.mode === 'commander' && t.slot === 0 ? ' · click for mouse-look' : ''}`, 12, t.css, 'center');
    });
  }

  drawPause(W, H) {
    const g = this.g, ctx = this.ctx;
    ctx.fillStyle = 'rgba(10,15,30,0.6)'; ctx.fillRect(0, 0, W, H);
    this.label(W / 2, H * 0.22, 'PAUSED', 72, '#ffdd33', 'center', 'middle', COMIC);
    const lines = KEYMAPS.map((k, i) => `${k.label}: ${k.help}`);
    lines.forEach((l, i) => this.label(W / 2, H * 0.36 + i * 28, l, 14, PLAYER_COLORS[i].css, 'center'));
    this.label(W / 2, H * 0.36 + 5 * 28, 'ESC / P resume · ` mute · X debug', 14, '#fff', 'center');
    const tips = ['Pick-ups: ❤ repair · 📦 ammo · 🟧 weapon crate · 💎 power-up', 'Red barrels explode — lure enemies close!', 'Mortars arc over cover · Rockets home in · Railgun pierces', 'Bulldogs deal big ram damage. Hornets drop mines while fleeing.'];
    tips.forEach((t, i) => this.label(W / 2, H * 0.72 + i * 24, t, 13, '#cfe', 'center'));
  }

  drawGameOver(W, H) {
    const g = this.g, ctx = this.ctx;
    const k = Math.min(1, g.overT * 1.5);
    ctx.fillStyle = `rgba(10,15,30,${0.35 * k})`; ctx.fillRect(0, 0, W, H);
    // confetti!
    if (!this.confetti || this.confettiFor !== g.winner) {
      this.confettiFor = g.winner;
      const cols = ['#ff5247', '#4d8cff', '#ffd133', '#59e666', '#ff7ad9', '#ffffff'];
      this.confetti = Array.from({ length: 160 }, () => ({ x: Math.random() * W, y: -Math.random() * H, vy: 60 + Math.random() * 90, sw: Math.random() * 6, r: Math.random() * 6, c: cols[Math.floor(Math.random() * cols.length)], s: 5 + Math.random() * 6 }));
    }
    const dt = 1 / 60;
    for (const c of this.confetti) {
      c.y += c.vy * dt; c.sw += dt * 3; c.r += dt * 4;
      if (c.y > H + 10) { c.y = -10; c.x = Math.random() * W; }
      ctx.save(); ctx.translate(c.x + Math.sin(c.sw) * 14, c.y); ctx.rotate(c.r);
      ctx.fillStyle = c.c; ctx.fillRect(-c.s / 2, -c.s / 4, c.s, c.s / 2);
      ctx.restore();
    }
    const w = g.winner;
    ctx.save();
    ctx.translate(W / 2, H * 0.2);
    const s = 0.6 + 0.4 * k + Math.sin(g.realTime * 3) * 0.03;
    ctx.scale(s, s);
    this.label(0, 0, w ? `${w.name.replace(' (bot)', '')} WINS!` : 'DRAW!', 78, w ? w.css : '#fff', 'center', 'middle', COMIC, '#2a1033');
    ctx.restore();
    this.label(W / 2, H * 0.2 + 56, g.winReason || '', 16, '#fff', 'center');
    const rows = [...g.tanks].sort((a, b) => b.score - a.score || a.deaths - b.deaths);
    // standings sit low so the winning tank stays visible centre-screen
    const tx = W / 2 - 300, ty = H - 80 - rows.length * 38;
    this.roundRect(tx - 10, ty - 30, 620, 40 + rows.length * 38, 14, 'rgba(15,20,35,0.75)');
    const cols = ['PLAYER', 'TANK', 'KILLS', 'DEATHS', 'DMG', 'ACC', 'PICKUPS'];
    const cx = [0, 170, 290, 360, 440, 510, 560];
    cols.forEach((c, i) => this.label(tx + cx[i], ty - 10, c, 11, '#9ab', 'left'));
    rows.forEach((t, i) => {
      const y = ty + 20 + i * 38;
      const acc = t.stats.shots ? Math.round((100 * t.stats.hits) / t.stats.shots) : 0;
      const vals = [`${i === 0 ? '🏆 ' : ''}${t.name}`, t.def.name, t.kills, t.deaths, Math.round(t.stats.dmg), acc + '%', t.stats.pickups];
      vals.forEach((v, j) => this.label(tx + cx[j], y, String(v), j === 0 ? 16 : 14, j === 0 ? t.css : '#fff', 'left'));
    });
    if (g.overT > 2.5) this.label(W / 2, H * 0.2 + 84, 'Press ENTER / SPACE / G to play again', 18, '#ffdd33', 'center');
  }

  // ---------- lobby ----------
  drawLobby(W, H) {
    const g = this.g, ctx = this.ctx;
    const t = g.realTime;
    // title
    ctx.save();
    ctx.translate(W / 2, H * 0.13);
    ctx.rotate(Math.sin(t * 1.3) * 0.02);
    const title = 'MICRO BATTLE';
    ctx.font = `${Math.min(110, W / 9)}px ${COMIC}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    const letters = title.split('');
    const total = ctx.measureText(title).width;
    let x = -total / 2;
    const cols = ['#ff5247', '#ffd133', '#4d8cff', '#59e666'];
    letters.forEach((ch, i) => {
      const w = ctx.measureText(ch).width;
      const y = Math.sin(t * 3 + i * 0.5) * 8;
      ctx.lineWidth = 18; ctx.strokeStyle = '#2a1033'; ctx.strokeText(ch, x + w / 2, y);
      ctx.lineWidth = 6; ctx.strokeStyle = '#fff'; ctx.strokeText(ch, x + w / 2, y);
      ctx.fillStyle = cols[i % 4]; ctx.fillText(ch, x + w / 2, y);
      x += w;
    });
    ctx.restore();
    this.label(W / 2, H * 0.13 + 66, `${g.cfg.mode === 'birdseye' ? "BIRD'S-EYE" : 'TANK COMMANDER'} MODE · first to ${g.cfg.scoreLimit} · ${g.cfg.difficulty} bots`, 16, '#fff', 'center');
    // player cards
    const cw = Math.min(250, (W - 80) / 4), ch = 300, gap = 16;
    const x0 = W / 2 - (cw * 4 + gap * 3) / 2, y0 = H * 0.3;
    g.slots.forEach((s, i) => {
      const x = x0 + i * (cw + gap);
      const col = PLAYER_COLORS[i];
      const bob = s.joined ? Math.sin(t * 4 + i) * 3 : 0;
      this.roundRect(x, y0 + bob, cw, ch, 18, s.joined ? 'rgba(20,25,45,0.82)' : 'rgba(20,25,45,0.5)', col.css);
      this.roundRect(x, y0 + bob, cw, 40, 18, col.css);
      this.label(x + cw / 2, y0 + bob + 21, `PLAYER ${i + 1}`, 20, '#fff', 'center', 'middle', COMIC, 'rgba(0,0,0,0.4)');
      if (!s.joined) {
        this.label(x + cw / 2, y0 + 110, 'BOT', 42, 'rgba(255,255,255,0.35)', 'center', 'middle', COMIC);
        const blink = Math.floor(t * 2) % 2 === 0;
        this.label(x + cw / 2, y0 + 180, 'press', 13, '#ccd', 'center');
        this.label(x + cw / 2, y0 + 204, JOIN_KEYS[i], 22, blink ? '#ffdd33' : '#fff', 'center');
        this.label(x + cw / 2, y0 + 228, 'to join', 13, '#ccd', 'center');
        if (i === 3) this.label(x + cw / 2, y0 + 260, '(gamepad 4)', 11, '#99a', 'center');
        return;
      }
      const def = TANK_TYPES[s.type];
      this.label(x + 16, y0 + bob + 72, '◀', 22, '#fff', 'left');
      this.label(x + cw - 16, y0 + bob + 72, '▶', 22, '#fff', 'right');
      this.label(x + cw / 2, y0 + bob + 72, def.name.toUpperCase(), 28, col.css, 'center', 'middle', COMIC);
      this.label(x + cw / 2, y0 + bob + 100, def.role, 14, '#fff', 'center');
      ctx.font = `12px ${FONT}`;
      this.label(x + cw / 2, y0 + bob + 122, def.blurb, 11, '#cde', 'center', 'middle', FONT, null);
      const pri = WEAPONS[def.weapons[0]];
      const stats = [
        ['SPEED', def.speed / 24], ['ARMOR', def.hp / 180], ['FIREPOWER', clamp((pri.dmg / pri.reload) / 45, 0.15, 1)],
        ['RANGE', { hornet: 0.35, trooper: 0.6, bulldog: 0.45, thumper: 0.95, longshot: 1 }[def.id]], ['TURRET', def.turret / 4],
      ];
      stats.forEach(([n, v], k) => {
        const yy = y0 + bob + 150 + k * 22;
        this.label(x + 16, yy, n, 10, '#abc', 'left');
        this.bar(x + 92, yy - 5, cw - 108, 10, v, col.css);
      });
      this.label(x + cw / 2, y0 + bob + 272, `${WEAPONS[def.weapons[0]].name} + ${WEAPONS[def.weapons[1]].name}`, 12, '#ffe08a', 'center');
    });
    const blink = Math.floor(t * 2.5) % 2 === 0;
    this.label(W / 2, y0 + ch + 44, 'Press G or START to battle!', 26, blink ? '#ffdd33' : '#fff', 'center', 'middle', COMIC);
    this.label(W / 2, y0 + ch + 76, 'Empty slots are filled with bots · steer left/right to change tank · press back/down to leave', 13, '#dde', 'center');
    if (g.cfg.lobbyTimeout > 0) this.label(W / 2, y0 + ch + 100, `auto-start in ${Math.ceil(Math.max(0, g.lobbyT))}s`, 13, '#ccd', 'center');
  }
}

function hpCol(f) { return f > 0.6 ? '#5be36b' : f > 0.3 ? '#ffd133' : '#ff4f4f'; }
