// Minimal RFC 6455 WebSocket server on Node built-ins (no dependencies).
// Supports text/binary messages, fragmentation, ping/pong and close.
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE = 1 << 20; // 1 MiB is plenty for game inputs

export class WebSocketConn extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frags = [];
    this.fragOp = 0;
    this.open = true;
    socket.setNoDelay(true);
    socket.on('data', (d) => this.onData(d));
    socket.on('close', () => this.finish());
    socket.on('error', () => this.finish());
  }

  finish() {
    if (!this.open) return;
    this.open = false;
    this.emit('close');
  }

  onData(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0, op = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (len > MAX_MESSAGE) { this.close(1009); return; }
      const need = off + (masked ? 4 : 0) + len;
      if (this.buf.length < need) return;
      let payload = this.buf.subarray(off + (masked ? 4 : 0), need);
      if (masked) {
        const mask = this.buf.subarray(off, off + 4);
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      }
      this.buf = this.buf.subarray(need);
      this.onFrame(fin, op, payload);
      if (!this.open) return;
    }
  }

  onFrame(fin, op, payload) {
    if (op === 0x8) { this.close(); return; }
    if (op === 0x9) { this.sendFrame(0xA, payload); return; }
    if (op === 0xA) return;
    if (op === 0x1 || op === 0x2) { this.fragOp = op; this.frags = [payload]; }
    else if (op === 0x0) this.frags.push(payload);
    else return;
    if (!fin) return;
    const data = Buffer.concat(this.frags);
    this.frags = [];
    this.emit('message', this.fragOp === 0x1 ? data.toString('utf8') : data);
  }

  sendFrame(op, payload) {
    if (!this.open) return;
    const len = payload.length;
    let header;
    if (len < 126) { header = Buffer.alloc(2); header[1] = len; }
    else if (len < 65536) { header = Buffer.alloc(4); header[1] = 126; header.writeUInt16BE(len, 2); }
    else { header = Buffer.alloc(10); header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
    header[0] = 0x80 | op;
    this.socket.write(Buffer.concat([header, payload]));
  }

  send(text) { this.sendFrame(0x1, Buffer.from(text, 'utf8')); }

  close(code = 1000) {
    if (!this.open) return;
    const p = Buffer.alloc(2); p.writeUInt16BE(code, 0);
    try { this.sendFrame(0x8, p); } catch { /* socket already gone */ }
    this.socket.end();
    this.finish();
  }
}

/** Complete the HTTP upgrade handshake; returns a connection or null if the request isn't a WebSocket. */
export function acceptUpgrade(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return null; }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  return new WebSocketConn(socket);
}
