#!/usr/bin/env node
// Headless test driver (dev tool, zero dependencies): serves ./public, launches headless Chromium,
// drives it over the DevTools protocol, and takes screenshots.
//
// Usage: node tools/shot.mjs script.json
//   script = { "url": "/?mode=birdseye&lobby=0", "width": 1280, "height": 720,
//              "steps": [ {"wait": 2000}, {"shot": "out/a.png"}, {"key": "KeyW", "ms": 800},
//                         {"keydown": "KeyQ"}, {"keyup": "KeyQ"}, {"eval": "MB.start()"},
//                         {"log": "JSON.stringify(MB.snapshot())"}, {"mouse": [640, 360]}, {"click": [640, 360]},
//                         {"mousedown": [x, y]}, {"mouseup": [x, y]} ] }
// Env: CHROME=/path/to/chrome overrides the browser binary.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const script = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const W = script.width || 1280, H = script.height || 720;

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

const MIME = { '.html': 'text/html', '.js': 'text/javascript' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/config.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end('window.MB_CONFIG = {};'); return; }
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const httpPort = server.address().port;

const chrome = findChrome();
if (!chrome) { console.error('No Chromium found; set CHROME=...'); process.exit(1); }
const dbgPort = 9300 + Math.floor(Math.random() * 500);
const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbshot-'));
const proc = spawn(chrome, [
  '--headless=new', `--remote-debugging-port=${dbgPort}`, `--user-data-dir=${userDir}`, `--window-size=${W},${H}`,
  '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required', '--ignore-gpu-blocklist',
  '--enable-webgl', '--use-angle=metal', '--enable-unsafe-swiftshader', '--mute-audio', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
proc.stderr.on('data', () => {});

let targets;
for (let i = 0; i < 60; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${dbgPort}/json`)).json(); if (targets.find((t) => t.type === 'page')) break; } catch { /* retry */ }
  await new Promise((r) => setTimeout(r, 150));
}
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
const logs = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled') logs.push(`[console.${m.params.type}] ` + m.params.args.map((a) => a.value ?? a.description).join(' '));
  if (m.method === 'Runtime.exceptionThrown') logs.push('[exception] ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${httpPort}${script.url || '/'}` });

const KEYS = { Space: [' ', 32], Enter: ['Enter', 13], Escape: ['Escape', 27], ArrowUp: ['ArrowUp', 38], ArrowDown: ['ArrowDown', 40], ArrowLeft: ['ArrowLeft', 37], ArrowRight: ['ArrowRight', 39], ShiftLeft: ['Shift', 16], Tab: ['Tab', 9], Backquote: ['`', 192] };
const keyInfo = (code) => {
  if (KEYS[code]) return KEYS[code];
  if (code.startsWith('Key')) return [code.slice(3).toLowerCase(), code.charCodeAt(3)];
  if (code.startsWith('Digit')) return [code.slice(5), code.charCodeAt(5)];
  return [code, 0];
};
// Synthetic DOM events: CDP Input.dispatchKeyEvent stalls requestAnimationFrame in headless mode.
const key = (type, code) => {
  const [k, vk] = keyInfo(code);
  const ev = type === 'keyDown' ? 'keydown' : 'keyup';
  return send('Runtime.evaluate', { expression: `window.dispatchEvent(new KeyboardEvent('${ev}', { code: ${JSON.stringify(code)}, key: ${JSON.stringify(k)}, keyCode: ${vk}, bubbles: true }))` });
};
const mouse = (type, x, y, button = 0) => send('Runtime.evaluate', { expression: `(() => { const c = document.getElementById('gl'); const o = { clientX: ${x}, clientY: ${y}, button: ${button}, bubbles: true }; c.dispatchEvent(new MouseEvent('${type}', o)); if ('${type}' === 'mouseup') window.dispatchEvent(new MouseEvent('mouseup', o)); })()` });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const s of script.steps || []) {
  if (s.wait) await sleep(s.wait);
  if (s.eval) { const r = await send('Runtime.evaluate', { expression: s.eval, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) logs.push('[eval error] ' + JSON.stringify(r.result.exceptionDetails.exception?.description)); }
  if (s.log) { const r = await send('Runtime.evaluate', { expression: s.log, awaitPromise: true, returnByValue: true }); console.log('LOG:', typeof r.result?.result?.value === 'string' ? r.result.result.value : JSON.stringify(r.result?.result?.value ?? r.result)); }
  if (s.keydown) await key('keyDown', s.keydown);
  if (s.keyup) await key('keyUp', s.keyup);
  if (s.key) { await key('keyDown', s.key); await sleep(s.ms || 100); await key('keyUp', s.key); }
  if (s.mouse) await mouse('mousemove', s.mouse[0], s.mouse[1]);
  if (s.mousedown) await mouse('mousedown', s.mousedown[0], s.mousedown[1]);
  if (s.mouseup) await mouse('mouseup', s.mouseup[0], s.mouseup[1]);
  if (s.click) { await mouse('mousedown', s.click[0], s.click[1]); await sleep(60); await mouse('mouseup', s.click[0], s.click[1]); }
  if (s.shot) {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(path.dirname(path.resolve(s.shot)), { recursive: true });
    fs.writeFileSync(s.shot, Buffer.from(r.result.data, 'base64'));
    console.log('SHOT:', s.shot);
  }
}
for (const l of logs) console.log(l);
ws.close();
proc.kill('SIGKILL');
server.close();
await sleep(300);
try { fs.rmSync(userDir, { recursive: true, force: true }); } catch { /* temp dir; ignore */ }
process.exit(0);
