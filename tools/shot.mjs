#!/usr/bin/env node
// Headless test driver (dev tool, zero dependencies): starts the real game server, opens one or more
// headless Chromium pages as network players, drives them over the DevTools protocol and takes screenshots.
//
// Usage: node tools/shot.mjs script.json
//   script = {
//     "server": ["--no-lobby", "--difficulty", "hard"],     // CLI options for microbattle.js
//     "clients": ["?name=Alice&view=chase", "?name=Bob"],   // one page per entry (default: one page "/")
//     "width": 1280, "height": 720,
//     "steps": [ {"wait": 2000}, {"c": 1, "shot": "out/b.png"}, {"key": "KeyW", "ms": 800},
//                {"keydown": "KeyQ"}, {"keyup": "KeyQ"}, {"eval": "MB.start()"},
//                {"log": "JSON.stringify(MB.snapshot())"}, {"mouse": [640, 360]}, {"click": [640, 360]} ] }
//   "c" picks the client page for a step (default 0).
// Env: CHROME=/path/to/chrome overrides the browser binary.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const W = script.width || 1280, H = script.height || 720;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const base = path.join(os.homedir(), 'Library/Caches/ms-playwright');
  const cands = [];
  if (fs.existsSync(base)) for (const d of fs.readdirSync(base)) {
    if (d.startsWith('chromium-')) cands.push(path.join(base, d, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'), path.join(base, d, 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'), path.join(base, d, 'chrome-linux/chrome'));
  }
  cands.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium');
  return cands.find((c) => fs.existsSync(c));
}

// --- game server ---
const srv = spawn(process.execPath, [path.join(ROOT, 'microbattle.js'), '--no-open', '--host', '127.0.0.1', '--port', String(18000 + Math.floor(Math.random() * 2000)), ...(script.server || [])], { stdio: ['ignore', 'pipe', 'pipe'] });
let srvOut = '';
srv.stdout.on('data', (d) => { srvOut += d; });
srv.stderr.on('data', (d) => { srvOut += d; });
let gamePort;
for (let i = 0; i < 100 && !gamePort; i++) { const m = srvOut.match(/running at http:\/\/[^:]+:(\d+)/); if (m) gamePort = +m[1]; else await sleep(100); }
if (!gamePort) { console.error('server failed to start:\n' + srvOut); process.exit(1); }

// --- browser ---
const chrome = findChrome();
if (!chrome) { console.error('No Chromium found; set CHROME=...'); process.exit(1); }
const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbshot-'));
const proc = spawn(chrome, [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${userDir}`, `--window-size=${W},${H}`,
  '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required', '--ignore-gpu-blocklist',
  '--enable-webgl', '--use-angle=metal', '--enable-unsafe-swiftshader', '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
proc.stderr.on('data', () => {});
let dbgPort;
for (let i = 0; i < 100 && !dbgPort; i++) {
  try { dbgPort = parseInt(fs.readFileSync(path.join(userDir, 'DevToolsActivePort'), 'utf8').split('\n')[0], 10); } catch { await sleep(100); }
}

const logs = [];
async function connect(wsUrl, label) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) logs.push(`[${label} console.${m.params.type}] ` + m.params.args.map((a) => a.value ?? a.description).join(' '));
    if (m.method === 'Runtime.exceptionThrown') logs.push(`[${label} exception] ` + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  return { ws, send };
}

let targets = [];
for (let i = 0; i < 60; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${dbgPort}/json`)).json(); if (targets.find((t) => t.type === 'page')) break; } catch { /* retry */ }
  await sleep(150);
}
const version = await (await fetch(`http://127.0.0.1:${dbgPort}/json/version`)).json();
const browser = await connect(version.webSocketDebuggerUrl, 'browser');
const clientUrls = script.clients || ['/'];
const pages = [];
for (let i = 0; i < clientUrls.length; i++) {
  let tid;
  if (i === 0) tid = targets.find((t) => t.type === 'page').id;
  else tid = (await browser.send('Target.createTarget', { url: 'about:blank' })).result.targetId;
  const list = await (await fetch(`http://127.0.0.1:${dbgPort}/json`)).json();
  const t = list.find((x) => x.id === tid);
  const p = await connect(t.webSocketDebuggerUrl, 'c' + i);
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await p.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const u = clientUrls[i];
  await p.send('Page.navigate', { url: `http://127.0.0.1:${gamePort}${u.startsWith('/') ? u : '/' + u}` });
  pages.push(p);
  await sleep(400);
}

const KEYS = { Space: [' ', 32], Enter: ['Enter', 13], Escape: ['Escape', 27], ArrowUp: ['ArrowUp', 38], ArrowDown: ['ArrowDown', 40], ArrowLeft: ['ArrowLeft', 37], ArrowRight: ['ArrowRight', 39], Tab: ['Tab', 9] };
const keyInfo = (code) => {
  if (KEYS[code]) return KEYS[code];
  if (code.startsWith('Key')) return [code.slice(3).toLowerCase(), code.charCodeAt(3)];
  if (code.startsWith('Digit')) return [code.slice(5), code.charCodeAt(5)];
  return [code, 0];
};
// Synthetic DOM events: CDP Input.dispatchKeyEvent stalls requestAnimationFrame in headless mode.
const evalIn = (p, expression) => p.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
const key = (p, type, code) => { const [k, vk] = keyInfo(code); return evalIn(p, `window.dispatchEvent(new KeyboardEvent('${type}', { code: ${JSON.stringify(code)}, key: ${JSON.stringify(k)}, keyCode: ${vk}, bubbles: true }))`); };
const mouse = (p, type, x, y) => evalIn(p, `(() => { const c = document.getElementById('gl'); const o = { clientX: ${x}, clientY: ${y}, button: 0, bubbles: true }; c.dispatchEvent(new MouseEvent('${type}', o)); if ('${type}' === 'mouseup') window.dispatchEvent(new MouseEvent('mouseup', o)); })()`);

for (const s of script.steps || []) {
  const p = pages[s.c || 0];
  if (s.wait) await sleep(s.wait);
  if (s.eval) { const r = await evalIn(p, s.eval); if (r.result?.exceptionDetails) logs.push('[eval error] ' + JSON.stringify(r.result.exceptionDetails.exception?.description)); }
  if (s.log) { const r = await evalIn(p, s.log); const v = r.result?.result?.value; console.log(`LOG(c${s.c || 0}):`, typeof v === 'string' ? v : JSON.stringify(v ?? r.result)); }
  if (s.keydown) await key(p, 'keydown', s.keydown);
  if (s.keyup) await key(p, 'keyup', s.keyup);
  if (s.key) { await key(p, 'keydown', s.key); await sleep(s.ms || 100); await key(p, 'keyup', s.key); }
  if (s.mouse) await mouse(p, 'mousemove', s.mouse[0], s.mouse[1]);
  if (s.mousedown) await mouse(p, 'mousedown', s.mousedown[0], s.mousedown[1]);
  if (s.mouseup) await mouse(p, 'mouseup', s.mouseup[0], s.mouseup[1]);
  if (s.click) { await mouse(p, 'mousedown', s.click[0], s.click[1]); await sleep(60); await mouse(p, 'mouseup', s.click[0], s.click[1]); }
  if (s.shot) {
    await p.send('Page.bringToFront');
    const r = await p.send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(path.dirname(path.resolve(s.shot)), { recursive: true });
    fs.writeFileSync(s.shot, Buffer.from(r.result.data, 'base64'));
    console.log('SHOT:', s.shot);
  }
}
for (const l of logs) console.log(l);
if (script.serverLog) console.log('SERVER:\n' + srvOut);
for (const p of pages) p.ws.close();
browser.ws.close();
proc.kill('SIGKILL');
srv.kill('SIGKILL');
await sleep(300);
try { fs.rmSync(userDir, { recursive: true, force: true }); } catch { /* temp dir; ignore */ }
process.exit(0);
