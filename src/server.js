// Servidor Express. Sirve estaticos + 4 endpoints:
//   GET /api/health  -> liveness probe (uptime, estado MQTT, clientes SSE)
//   GET /api/config  -> metadata (sensores, rangos, umbrales)
//   GET /api/data    -> snapshot completo para hidratacion inicial
//   GET /api/stream  -> SSE, empuja eventos cuando el store cambia

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';

import {
  TEMP_MIN, TEMP_MAX, HUM_MIN, HUM_MAX,
  ALERT_WARN_MIN, ALERT_ERROR_MIN,
  TEMP_ALERT_LOW, TEMP_ALERT_HIGH,
  HUM_ALERT_LOW, HUM_ALERT_HIGH,
} from './config.js';
import { SENSORS, ZONES, DEVICE, ALL_VARIABLES } from './sensorsMap.js';
import { getLogger } from './logger.js';

const logger = getLogger('server');
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

// Inyectado en HTML como query string para bustear cache de browsers cada reinicio.
const BUILD_VERSION = Date.now().toString(36);

// index.html leido una sola vez al arrancar; no bloqueamos el event loop por request.
const indexHtmlRaw = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf-8');

export function createApp({ store, sseHub, mqttStatusFn = () => false }) {
  const app = express();

  // Headers de seguridad basicos y CORS permisivo para red LAN.
  // Sin helmet para no romper CSP de CDNs externos (Babylon.js, Google Fonts).
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Access-Control-Allow-Origin', '*');
    next();
  });

  // Estaticos sin cache (SSE actualiza datos, no necesitamos cache de JS/CSS).
  app.use(express.static(PUBLIC_DIR, {
    etag: false,
    lastModified: false,
    index: false,
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    },
  }));

  // --- GET / ---
  app.get('/', (req, res) => {
    const html = indexHtmlRaw.replace(/(src|href)="\/(js|css)\/([^"]+)"/g,
      (_, attr, dir, file) => `${attr}="/${dir}/${file}?v=${BUILD_VERSION}"`);
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'no-store');
    res.send(html);
  });

  // --- GET /api/health ---
  app.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      uptime: process.uptime(),
      mqtt_connected: mqttStatusFn(),
      sse_clients: sseHub.clientCount(),
    });
  });

  // --- GET /api/config ---
  app.get('/api/config', (req, res) => {
    res.json({
      device: DEVICE,
      zones: ZONES,
      sensors: SENSORS,
      variables: ALL_VARIABLES,
      ranges: {
        temp: { min: TEMP_MIN, max: TEMP_MAX },
        hum: { min: HUM_MIN, max: HUM_MAX },
      },
      alertRanges: {
        temp: { low: TEMP_ALERT_LOW, high: TEMP_ALERT_HIGH },
        hum: { low: HUM_ALERT_LOW, high: HUM_ALERT_HIGH },
      },
      thresholds: {
        warnMin: ALERT_WARN_MIN,
        errorMin: ALERT_ERROR_MIN,
      },
      mqtt_connected: mqttStatusFn(),
      transport: 'sse',
    });
  });

  // --- GET /api/data ---
  app.get('/api/data', (req, res) => {
    res.json(store.getAll());
  });

  // --- GET /api/stream (SSE) ---
  app.get('/api/stream', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // desactiva buffering si hay nginx delante
    });

    // Hidratacion inmediata: enviamos el snapshot completo al conectar.
    res.write(`event: snapshot\ndata: ${JSON.stringify(store.getAll())}\n\n`);

    sseHub.register(res);
  });

  return app;
}

export function start(app, host, port) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      logger.info(`Web server listening on http://${host}:${port}`);
      resolve(server);
    });
    server.on('error', reject);
  });
}
