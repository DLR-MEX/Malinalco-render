// Entry point. Cablea snapshot store + sseHub + driver de datos (mock en Fase 1,
// MQTT real en Fase 2) + servidor Express.

import { SnapshotStore } from './snapshotStore.js';
import { SseHub } from './sseHub.js';
import { createApp, start } from './server.js';
import { startMockDriver } from './mockDriver.js';
import { MqttClient } from './mqttClient.js';
import { resolveVariable } from './sensorsMap.js';
import { WEB_HOST, WEB_PORT, MOCK_DATA } from './config.js';
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

  const app = createApp({ store, sseHub, mqttStatusFn });
  const server = await start(app, WEB_HOST, WEB_PORT);

  function shutdown() {
    logger.info('Shutting down...');
    stopDriver();
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
