// Thin WebSocket wrapper with JSON messages and auto-reconnect.

export class Net {
  constructor(url, onMessage, onStatus) {
    this.url = url;
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.ws = null;
    this.open = false;
    this.connect();
  }

  connect() {
    this.onStatus('connecting');
    const ws = (this.ws = new WebSocket(this.url));
    ws.onopen = () => { this.open = true; this.onStatus('open'); };
    ws.onmessage = (e) => { try { this.onMessage(JSON.parse(e.data)); } catch (err) { console.error(err); } };
    ws.onclose = () => {
      this.open = false;
      this.onStatus('closed');
      setTimeout(() => this.connect(), 1500);
    };
  }

  send(m) { if (this.open) this.ws.send(JSON.stringify(m)); }
}
