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

export function createApp({
  store, sseHub, mqttStatusFn = () => false, agent = null, telegram = null,
  reports = null, scheduler = null,
}) {
  const app = express();

  // Body parser para los endpoints POST del agente (el resto del dashboard es
  // solo lectura). Limite chico: el chat manda mensaje + historial corto.
  app.use(express.json({ limit: '256kb' }));

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

  // --- POST /api/agent/chat (agente IA conversacional) ---
  // Recibe { message, history }. Inyecta el system prompt en el agente y
  // devuelve { reply, tool_calls, charts, reports, model }.
  const MAX_HISTORY = 20;
  const MAX_MESSAGE_LEN = 2000;
  app.post('/api/agent/chat', async (req, res) => {
    if (!agent || !agent.ready) {
      return res.status(503).json({
        error: 'Agente IA no configurado. Setea OLLAMA_API_KEY en .env y reinicia el servidor.',
      });
    }
    const body = req.body || {};
    const message = String(body.message || '').trim();
    let history = Array.isArray(body.history) ? body.history : [];

    if (!message) return res.status(400).json({ error: "campo 'message' es requerido" });
    if (message.length > MAX_MESSAGE_LEN) {
      return res.status(400).json({ error: `message excede ${MAX_MESSAGE_LEN} caracteres` });
    }
    if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);

    // Sanitizar: solo role/content de turnos user/assistant
    const cleanHistory = [];
    for (const m of history) {
      if (!m || typeof m !== 'object') continue;
      if ((m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string') {
        cleanHistory.push({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_LEN) });
      }
    }

    const messages = [...cleanHistory, { role: 'user', content: message }];
    logger.info(`agent.qa PREGUNTA: ${message.slice(0, 300)}`);
    try {
      const result = await agent.chat(messages);
      const tools = (result.tool_calls || []).map((t) => t.name);
      logger.info(`agent.qa RESPUESTA (tools=${tools.join(',')}): ${(result.reply || '').slice(0, 400)}`);
      return res.json(result);
    } catch (e) {
      logger.error(`agent.chat error: ${e.message}`);
      return res.status(502).json({ error: `Agente fallo: ${e.message}` });
    }
  });

  // --- Telegram (config + test) ---
  // El bot_token NUNCA se acepta por API: solo vive en .env. Aqui solo se
  // ajustan chat_id, enabled y cooldown en runtime.
  app.get('/api/telegram', (req, res) => {
    if (!telegram) return res.json({ enabled: false, chat_id: '', cooldown_sec: 0, token_configured: false });
    res.json(telegram.snapshot());
  });

  app.post('/api/telegram', (req, res) => {
    if (!telegram) return res.status(503).json({ error: 'Telegram no disponible en este servidor.' });
    const body = req.body || {};
    if ('bot_token' in body) {
      return res.status(403).json({ error: 'El bot_token solo se configura en .env, no por API.' });
    }
    const patch = {};
    if (typeof body.chat_id === 'string') patch.chatId = body.chat_id;
    if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
    if (body.cooldown_sec !== undefined) {
      const c = Number(body.cooldown_sec);
      if (!Number.isFinite(c) || c < 30 || c > 3600) {
        return res.status(400).json({ error: 'cooldown_sec debe estar entre 30 y 3600' });
      }
      patch.cooldownSec = c;
    }
    res.json(telegram.updateSettings(patch));
  });

  app.post('/api/telegram/test', async (req, res) => {
    if (!telegram) return res.status(503).json({ sent: false, message: 'Telegram no disponible.' });
    try {
      const result = await telegram.test();
      res.json(result);
    } catch (e) {
      res.status(502).json({ sent: false, message: `Error: ${e.message}` });
    }
  });

  // --- Reportes PDF ---
  app.post('/api/reports/generate', async (req, res) => {
    if (!reports) return res.status(503).json({ error: 'Reportes no disponibles en este servidor.' });
    const body = req.body || {};
    const now = Date.now();
    let startMs;
    let endMs;
    const hours = Number(body.hours);
    if (Number.isFinite(hours) && hours > 0) {
      endMs = now;
      startMs = now - Math.min(hours, 744) * 3600 * 1000;
    } else if (body.start_iso && body.end_iso) {
      startMs = Date.parse(body.start_iso);
      endMs = Date.parse(body.end_iso);
      if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
        return res.status(400).json({ error: 'fechas ISO invalidas' });
      }
    } else {
      endMs = now;
      startMs = now - 24 * 3600 * 1000;
    }
    try {
      const card = await reports.generate({
        startMs, endMs, title: body.title || null, sendToTelegram: Boolean(body.send_to_telegram),
      });
      res.json(card);
    } catch (e) {
      logger.error(`reports.generate error: ${e.message}`);
      res.status(502).json({ error: `No se pudo generar el reporte: ${e.message}` });
    }
  });

  app.get('/api/reports', (req, res) => {
    if (!reports) return res.json({ reports: [] });
    res.json({ reports: reports.list() });
  });

  app.get('/api/reports/:id', (req, res) => {
    if (!reports) return res.status(503).json({ error: 'Reportes no disponibles.' });
    const file = reports.filePath(req.params.id, 'pdf');
    if (!file) return res.status(404).json({ error: 'reporte no encontrado' });
    res.sendFile(file);
  });

  app.get('/api/reports/:id/preview', (req, res) => {
    if (!reports) return res.status(503).json({ error: 'Reportes no disponibles.' });
    const file = reports.filePath(req.params.id, 'preview');
    if (!file) return res.status(404).json({ error: 'preview no encontrado' });
    res.sendFile(file);
  });

  // --- Schedules (reportes recurrentes) ---
  app.get('/api/schedules', (req, res) => {
    if (!scheduler) return res.json({ schedules: [] });
    res.json({ schedules: scheduler.list() });
  });

  app.post('/api/schedules', (req, res) => {
    if (!scheduler) return res.status(503).json({ error: 'Scheduler no disponible.' });
    const body = req.body || {};
    try {
      const r = scheduler.add({
        name: body.name,
        cron: body.cron,
        friendlyCron: body.friendly_cron,
        periodKind: body.period_kind || 'daily',
        deliverTo: Array.isArray(body.deliver_to) && body.deliver_to.length ? body.deliver_to : ['disk'],
        title: body.title || null,
      });
      res.json(r);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete('/api/schedules/:id', (req, res) => {
    if (!scheduler) return res.status(503).json({ error: 'Scheduler no disponible.' });
    res.json({ ok: scheduler.remove(req.params.id), schedule_id: req.params.id });
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
