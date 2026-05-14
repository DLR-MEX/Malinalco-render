// Snapshot en memoria con el ultimo valor + timestamp de cada (device, variable).
// Emite evento 'change' cada vez que update() guarda un valor nuevo, para que el
// SSE hub pueda empujar al frontend sin polling.
//
// getAll() agrupa por ZONA: cada zona tiene su lista de sensores con sus
// lecturas + un promedio (avg, count, latestTs) para que el sidebar muestre
// directamente el valor agregado de la zona.

import { EventEmitter } from 'node:events';
import { ZONES, SENSORS, DEVICE, ZONE_CAPACITY } from './sensorsMap.js';

function keyOf(device, variable) {
  return `${device}/${variable}`;
}

function average(values) {
  if (!values.length) return null;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

export class SnapshotStore extends EventEmitter {
  constructor() {
    super();
    this._data = new Map(); // key -> { value, ts }
    this._lastUpdate = null;
  }

  update(device, variable, value, ts = Date.now()) {
    const key = keyOf(device, variable);
    this._data.set(key, { value, ts });
    this._lastUpdate = ts;
    this.emit('change', { device, variable, value, ts });
  }

  get(device, variable) {
    return this._data.get(keyOf(device, variable)) || null;
  }

  /**
   * Snapshot agrupado por zona. Estructura:
   *   {
   *     lastUpdate: 1715712345678,
   *     zones: [
   *       {
   *         id, label, tunnels: [...],
   *         sensors: [{ id, label, tunnel, coords3D, temp, hum }, ...],
   *         temp: { avg, count, latestTs } | { avg: null, count: 0 },
   *         hum:  { avg, count, latestTs } | { avg: null, count: 0 },
   *       },
   *       ...
   *     ]
   *   }
   */
  getAll() {
    const zones = ZONES.map((zone) => {
      const zoneSensors = SENSORS
        .filter((s) => s.zone === zone.id)
        .map((s) => ({
          id: s.id,
          label: s.label,
          tunnel: s.tunnel,
          coords3D: s.coords3D,
          temp: s.tempVariable ? this.get(DEVICE, s.tempVariable) : null,
          hum: s.humVariable ? this.get(DEVICE, s.humVariable) : null,
        }));

      const tempReadings = zoneSensors
        .map((s) => s.temp)
        .filter((r) => r && r.value !== null);
      const humReadings = zoneSensors
        .map((s) => s.hum)
        .filter((r) => r && r.value !== null);

      const { temp: tempCapacity, hum: humCapacity } = ZONE_CAPACITY[zone.id];

      return {
        id: zone.id,
        label: zone.label,
        tunnels: zone.tunnels,
        sensors: zoneSensors,
        temp: tempReadings.length
          ? {
              avg: average(tempReadings.map((r) => r.value)),
              count: tempReadings.length,
              capacity: tempCapacity,
              latestTs: Math.max(...tempReadings.map((r) => r.ts)),
            }
          : { avg: null, count: 0, capacity: tempCapacity, latestTs: null },
        hum: humReadings.length
          ? {
              avg: average(humReadings.map((r) => r.value)),
              count: humReadings.length,
              capacity: humCapacity,
              latestTs: Math.max(...humReadings.map((r) => r.ts)),
            }
          : { avg: null, count: 0, capacity: humCapacity, latestTs: null },
      };
    });

    return { lastUpdate: this._lastUpdate, zones };
  }
}
