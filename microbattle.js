#!/usr/bin/env node
// Micro Battle server: parses CLI options, serves the game, hosts the networked match over WebSocket
// (players on other machines join by opening the printed LAN address) and opens it in your browser.
// Zero dependencies — only Node built-ins.
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { OPTIONS, parseValue, resolveConfig, toCamel, toKebab } from './public/js/config.js';
import { acceptUpgrade } from './server/ws.js';
import { Room } from './server/room.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon' };

function usage() {
  const lines = [
    'Micro Battle — networked 3D toy tank battles for up to 4 players (+ bots)',
    '',
    'Usage: node microbattle.js [options]',
    '',
    'Game options:',
  ];
  for (const [k, [def, type, desc, allowed]] of Object.entries(OPTIONS)) {
    const flag = `--${toKebab(k)}${type === 'bool' ? '' : ' <' + (allowed ? allowed.join('|') : type === 'list' ? 'a,b' : type === 'intOrAuto' ? 'n|auto' : type) + '>'}`;
    lines.push(`  ${flag.padEnd(36)} ${desc} (default: ${def === '' ? 'none' : def})`);
  }
  lines.push('', 'Server options:', '  --port <n>                           HTTP/WebSocket port (default 8080)', '  --host <addr>                        Bind address (default 0.0.0.0 = reachable on your LAN)', '  --no-open                            Do not open a browser on this machine', '  --help                               Show this help', '');
  lines.push('Booleans accept --flag, --no-flag or --flag=false.', '', 'Examples:',
    '  node microbattle.js                                   # lobby; friends open the printed LAN URL',
    '  node microbattle.js --mode commander --players 2       # start when 2 players have joined',
    '  node microbattle.js --no-lobby --difficulty hard       # bots fight now; players drop in any time',
    '  node microbattle.js --lives 3 --map-size 500 --seed 42', '');
  return lines.join('\n');
}

function parseArgs(argv) {
  const game = {}, server = { port: 8080, host: '0.0.0.0', open: true };
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    if (a === '--help' || a === '-h') { console.log(usage()); process.exit(0); }
    if (!a.startsWith('--')) { console.error(`Unexpected argument: ${a}`); process.exit(1); }
    a = a.slice(2);
    let val;
    const eq = a.indexOf('=');
    if (eq >= 0) { val = a.slice(eq + 1); a = a.slice(0, eq); }
    let neg = false;
    if (a.startsWith('no-')) { neg = true; a = a.slice(3); }
    const key = toCamel(a);
    if (key === 'port' || key === 'host') { server[key] = val ?? argv[++i]; continue; }
    if (key === 'open') { server.open = !neg; continue; }
    if (!(key in OPTIONS)) { console.error(`Unknown option --${a}. Run with --help.`); process.exit(1); }
    const type = OPTIONS[key][1];
    if (type === 'bool') {
      if (neg) val = 'false';
      else if (val === undefined && argv[i + 1] && /^(true|false|on|off|yes|no|0|1)$/i.test(argv[i + 1])) val = argv[++i];
      else if (val === undefined) val = 'true';
    } else if (val === undefined) {
      val = argv[++i];
      if (val === undefined) { console.error(`--${a} needs a value`); process.exit(1); }
    }
    const parsed = parseValue(key, val);
    if (OPTIONS[key][3] && !OPTIONS[key][3].includes(String(val).toLowerCase())) console.warn(`Warning: --${a} ${val} is not one of ${OPTIONS[key][3].join(', ')}; using ${parsed}`);
    game[key] = parsed;
  }
  server.port = parseInt(server.port, 10) || 8080;
  return { game, server };
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).unref(); } catch { /* user can open the URL manually */ }
}

const { game, server } = parseArgs(process.argv.slice(2));
const cfg = resolveConfig(game);
const room = new Room(cfg, (m) => console.log('  · ' + m));

const srv = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

srv.on('upgrade', (req, socket) => {
  if (new URL(req.url, 'http://x').pathname !== '/ws') { socket.destroy(); return; }
  const ws = acceptUpgrade(req, socket);
  if (ws) room.join(ws);
});

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
}

let port = server.port;
srv.on('error', (e) => {
  if (e.code === 'EADDRINUSE' && port < server.port + 20) { port++; srv.listen(port, server.host); }
  else { console.error(e.message); process.exit(1); }
});
srv.on('listening', () => {
  port = srv.address().port;
  const url = `http://${server.host === '0.0.0.0' ? 'localhost' : server.host}:${port}/`;
  console.log(`\n  MICRO BATTLE is running at ${url}`);
  if (server.host === '0.0.0.0') for (const a of lanAddresses()) console.log(`  other players on your network: http://${a}:${port}/`);
  console.log(`  view mode: ${cfg.mode === 'any' ? 'players choose (C)' : cfg.mode} · seed ${cfg.seed}`);
  const shown = Object.keys(game).length ? Object.entries(game).map(([k, v]) => `${toKebab(k)}=${v}`).join(' ') : '(defaults)';
  console.log(`  options: ${shown}`);
  console.log('  Press Ctrl+C to stop.\n');
  if (server.open) openBrowser(url);
});
srv.listen(port, server.host);
