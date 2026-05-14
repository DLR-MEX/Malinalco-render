// Driver de datos mock: inyecta valores aleatorios al snapshot store cada
// MOCK_INTERVAL_MS, simulando lo que enviaria el cliente MQTT real. Util para
// desarrollar el frontend sin Ubidots. Activo solo si MOCK_DATA=true.

import { SENSORS, DEVICE } from './sensorsMap.js';
import { MOCK_INTERVAL_MS } from './config.js';
import { getLogger } from './logger.js';

const logger = getLogger('mock');

// Tupla plana (sensor, mode, variable) para todas las variables mapeadas.
const ENTRIES = SENSORS.flatMap((s) => {
  const out = [];
  if (s.tempVariable) out.push({ sensor: s, mode: 'temp', variable: s.tempVariable });
  if (s.humVariable) out.push({ sensor: s, mode: 'hum', variable: s.humVariable });
  return out;
});

function targetFor(zone, mode) {
  if (mode === 'temp') return zone.startsWith('hab') ? 22 : 28;
  return zone.startsWith('hab') ? 80 : 70;
}

function jitter(base, amplitude = 2) {
  return base + (Math.random() - 0.5) * amplitude * 2;
}

export function startMockDriver(store) {
  logger.warn('MOCK_DATA=true: inyectando valores aleatorios cada ' + MOCK_INTERVAL_MS + 'ms');

  // Poblacion inicial: todos los sensores con su valor target para que el
  // sidebar no muestre "sin datos" hasta que el primer tick aleatorio los cubra.
  for (const e of ENTRIES) {
    const value = Number(jitter(targetFor(e.sensor.zone, e.mode)).toFixed(1));
    store.update(DEVICE, e.variable, value);
  }

  const handle = setInterval(() => {
    if (ENTRIES.length === 0) return;
    const e = ENTRIES[Math.floor(Math.random() * ENTRIES.length)];
    const value = Number(jitter(targetFor(e.sensor.zone, e.mode)).toFixed(1));
    store.update(DEVICE, e.variable, value);
  }, MOCK_INTERVAL_MS);

  return () => clearInterval(handle);
}
