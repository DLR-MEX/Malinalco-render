// Entry point. Cablea snapshot store + sseHub + driver de datos (mock en Fase 1,
// MQTT real en Fase 2) + servidor Express.

import { SnapshotStore } from './snapshotStore.js';
import { SseHub } from './sseHub.js';
import { createApp, start } from './server.js';
import { startMockDriver } from './mockDriver.js';
import { MqttClient } from './mqttClient.js';
import { resolveVariable } from './sensorsMap.js';
import {
  WEB_HOST, WEB_PORT, MOCK_DATA,
  AGENT_ENABLED, OLLAMA_HOST, OLLAMA_MODEL, OLLAMA_API_KEY,
  UBIDOTS_TOKEN, ALERT_DB_PATH, REPORTS_ENABLED,
} from './config.js';
import { AgentService } from './agent/agent.js';
import { createTools } from './agent/tools.js';
import { UbidotsHTTP } from './ubidotsApi.js';
import { AlertLog } from './alertLog.js';
import { TelegramNotifier } from './telegram.js';
import { AlertMonitor } from './alertMonitor.js';
import { ReportsService } from './reports/service.js';
import { ReportScheduler } from './reports/scheduler.js';
import { getLogger } from './logger.js';

const logger = getLogger('index');

async function main() {
  const store = new SnapshotStore();
  const sseHub = new SseHub();

  // Cualquier cambio en el store se empuja a todos los clientes SSE conectados.
  // Mandamos: (1) el snapshot completo recalculado (para que el frontend tenga
  // los promedios actualizados sin matematica local) + (2) un evento `data`
  // ligero con sensorId/zone/mode para reaccionar a cambios individuales.
  store.on('change', (evt) => {
    const resolved = resolveVariable(evt.variable);
    sseHub.broadcast('snapshot', store.getAll());
    sseHub.broadcast('data', {
      ...evt,
      sensorId: resolved?.sensor?.id ?? null,
      zone: resolved?.sensor?.zone ?? null,
      mode: resolved?.mode ?? null,
    });
  });

  let stopDriver = () => {};
  let mqttStatusFn = () => false;

  if (MOCK_DATA) {
    stopDriver = startMockDriver(store);
    mqttStatusFn = () => true; // el mock siempre esta "conectado"
  } else {
    const mqttClient = new MqttClient(store);
    mqttClient.start();
    mqttStatusFn = () => mqttClient.isConnected();
    stopDriver = () => mqttClient.stop();
  }

  // Alertas (Fase 3): AlertLog persiste transiciones en SQLite; el AlertMonitor
  // se suscribe al store, clasifica con histeresis y dispara Telegram + saltos.
  const alertLog = new AlertLog(ALERT_DB_PATH);
  alertLog.cleanup(30); // poda registros > 30 dias al arrancar
  const telegram = new TelegramNotifier();
  const alertMonitor = new AlertMonitor({ store, alertLog, telegram });

  // Agente IA: registro de tools + servicio Ollama. Si no hay OLLAMA_API_KEY,
  // el agente queda inactivo (503 en el chat). El cliente Ubidots HTTP habilita
  // las tools de historico/graficas (requiere UBIDOTS_TOKEN); el AlertLog habilita
  // get_recent_alerts.
  const ubidots = UBIDOTS_TOKEN ? new UbidotsHTTP(UBIDOTS_TOKEN) : null;

  // Reportes (Fase 4): servicio de generacion PDF + scheduler de recurrentes.
  // Se renderizan con puppeteer (Chromium); el scheduler persiste sus jobs en JSON.
  let reports = null;
  let scheduler = null;
  if (REPORTS_ENABLED) {
    reports = new ReportsService({ store, ubidots, alertLog, telegram });
    scheduler = new ReportScheduler({
      generate: (opts) => reports.generate(opts),
    });
    scheduler.start();
  }

  const tools = createTools({ store, ubidots, alertLog, reports, scheduler });
  const agent = new AgentService({
    apiKey: OLLAMA_API_KEY,
    host: OLLAMA_HOST,
    model: OLLAMA_MODEL,
    enabled: AGENT_ENABLED,
    tools,
  });

  const app = createApp({ store, sseHub, mqttStatusFn, agent, telegram, reports, scheduler });
  const server = await start(app, WEB_HOST, WEB_PORT);

  function shutdown() {
    logger.info('Shutting down...');
    stopDriver();
    alertMonitor.stop();
    alertLog.close();
    if (scheduler) scheduler.stop();
    if (reports) reports.close().catch(() => {});
    sseHub.stop();
    server.close(() => {
      logger.info('Application shut down.');
      process.exit(0);
    });
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error(`Fatal error: ${err.stack || err.message}`);
  process.exit(1);
});
