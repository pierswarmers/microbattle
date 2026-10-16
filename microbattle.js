#!/usr/bin/env node
// Micro Battle launcher: parses CLI options, serves the game and opens it in your browser.
// Zero dependencies — only Node built-ins.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { OPTIONS, parseValue, toCamel, toKebab } from './public/js/config.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon' };

function usage() {
  const lines = [
    'Micro Battle — 3D toy tank battles for up to 4 players (+ bots)',
    '',
    'Usage: node microbattle.js [options]',
    '',
    'Game options:',
  ];
  for (const [k, [def, type, desc, allowed]] of Object.entries(OPTIONS)) {
    const flag = `--${toKebab(k)}${type === 'bool' ? '' : ' <' + (allowed ? allowed.join('|') : type === 'list' ? 'a,b' : type === 'intOrAuto' ? 'n|auto' : type) + '>'}`;
    lines.push(`  ${flag.padEnd(36)} ${desc} (default: ${def === '' ? 'none' : def})`);
  }
  lines.push('', 'Server options:', '  --port <n>                           HTTP port (default 8080)', '  --host <addr>                        Bind address (default 127.0.0.1)', '  --no-open                            Do not open a browser', '  --help                               Show this help', '');
  lines.push('Booleans accept --flag, --no-flag or --flag=false.', '', 'Examples:',
    '  node microbattle.js --mode commander --players 2 --tanks bulldog,longshot',
    '  node microbattle.js --mode birdseye --players 0 --bots 4 --difficulty hard   # watch the bots',
    '  node microbattle.js --players 3 --no-lobby --lives 3 --map-size 500 --seed 42', '');
  return lines.join('\n');
}

function parseArgs(argv) {
  const game = {}, server = { port: 8080, host: '127.0.0.1', open: true };
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
const configJs = `window.MB_CONFIG = ${JSON.stringify(game)};\n`;

const srv = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let p = decodeURIComponent(url.pathname);
  if (p === '/config.js') { res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-store' }); res.end(configJs); return; }
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

let port = server.port;
srv.on('error', (e) => {
  if (e.code === 'EADDRINUSE' && port < server.port + 20) { port++; srv.listen(port, server.host); }
  else { console.error(e.message); process.exit(1); }
});
srv.on('listening', () => {
  const url = `http://${server.host === '0.0.0.0' ? 'localhost' : server.host}:${port}/`;
  console.log(`\n  MICRO BATTLE is running at ${url}`);
  const shown = Object.keys(game).length ? Object.entries(game).map(([k, v]) => `${toKebab(k)}=${v}`).join(' ') : '(defaults)';
  console.log(`  options: ${shown}`);
  console.log('  Press Ctrl+C to stop.\n');
  if (server.open) openBrowser(url);
});
srv.listen(port, server.host);
