// Hub de clientes SSE. Cada conexion HTTP a /api/stream queda registrada y
// recibe broadcasts cuando el snapshot store emite 'change'.

import { getLogger } from './logger.js';

const logger = getLogger('sseHub');

// Intervalo de heartbeat: comentarios SSE para mantener viva la conexion
// detras de proxies que cierran HTTP idle (Nginx default 60s, etc.).
const HEARTBEAT_MS = 25000;

export class SseHub {
  constructor() {
    this._clients = new Set();
    this._heartbeat = setInterval(() => this._sendHeartbeat(), HEARTBEAT_MS);
  }

  // Registra un cliente SSE. El caller ya debe haber escrito los headers HTTP.
  register(res) {
    this._clients.add(res);
    logger.info(`SSE client connected (total=${this._clients.size})`);

    res.on('close', () => {
      this._clients.delete(res);
      logger.info(`SSE client disconnected (total=${this._clients.size})`);
    });
  }

  clientCount() {
    return this._clients.size;
  }

  // Emite un evento nombrado a todos los clientes.
  broadcast(eventName, payload) {
    const data = JSON.stringify(payload);
    const frame = `event: ${eventName}\ndata: ${data}\n\n`;
    for (const res of this._clients) {
      try {
        res.write(frame);
      } catch (e) {
        logger.warn(`SSE write failed: ${e.message}`);
        this._clients.delete(res);
      }
    }
  }

  _sendHeartbeat() {
    for (const res of this._clients) {
      try {
        res.write(`: heartbeat ${Date.now()}\n\n`);
      } catch {
        // ignorado, el close handler limpia
      }
    }
  }

  stop() {
    clearInterval(this._heartbeat);
    for (const res of this._clients) {
      try { res.end(); } catch {}
    }
    this._clients.clear();
  }
}
