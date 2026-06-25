// Recolector de datos para reportes ejecutivos. Unifica las fuentes existentes
// (store en vivo + AlertLog SQLite + historico Ubidots HTTP) en una estructura
// unica que consume render.js.
//
// Portado/simplificado de ai-predictor/app/reports/collector.py. Malinalco es
// mas simple que Tenebrios: 8 sensores interiores, sin infraestructura, sin
// sensores exteriores y sin predicciones. Se omiten esas secciones.

import { getLogger } from '../logger.js';
import { SENSORS, DEVICE } from '../sensorsMap.js';
import { classify, rangeFor, GROUP_UNITS } from '../thresholds.js';
import { computeAggregations } from './aggregations.js';

const log = getLogger('reports.collector');

// Limites fisicos por grupo: descartan lecturas imposibles del historico
// (p.ej. humedad 119% de un sensor descalibrado) para que no contaminen stats,
// agregaciones ni graficas.
const PHYSICAL_LIMITS = { TEMP: [-20, 80], HUM: [0, 100] };
function isPhysical(value, group) {
  if (typeof value !== 'number' || Number.isNaN(value)) return false;
  const [lo, hi] = PHYSICAL_LIMITS[group] || [-Infinity, Infinity];
  return value >= lo && value <= hi;
}

// Variables por grupo, derivadas del catalogo de sensores.
function varsOfGroup(group) {
  const key = group === 'TEMP' ? 'tempVariable' : 'humVariable';
  return SENSORS.filter((s) => s[key]).map((s) => ({ var: s[key], sensor: s.sidebarLabel, zone: s.zone }));
}

function round1(v) {
  return typeof v === 'number' && !Number.isNaN(v) ? Math.round(v * 10) / 10 : null;
}

// Redondea un epoch(ms) hacia abajo al inicio del dia local (00:00) para que las
// agregaciones por dia/hora arranquen completas.
export function floorToLocalMidnight(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function statsOf(rows, group) {
  const values = rows.map((r) => r.value).filter((x) => typeof x === 'number' && !Number.isNaN(x));
  if (!values.length) return { min: null, max: null, avg: null, n: 0, time_outside_pct: null };
  let min = Infinity, max = -Infinity, sum = 0;
  for (const x of values) { if (x < min) min = x; if (x > max) max = x; sum += x; }
  const { low, high } = rangeFor(group);
  const outside = values.filter((x) => x < low || x > high).length;
  return {
    min: round1(min), max: round1(max), avg: round1(sum / values.length),
    n: values.length, time_outside_pct: Math.round((outside / values.length) * 100),
  };
}

/**
 * Recolecta todos los datos del periodo [startMs, endMs].
 * @param {object} deps { store, ubidots, alertLog }
 */
export async function collectPeriodData({ store, ubidots, alertLog }, startMs, endMs) {
  const start = floorToLocalMidnight(startMs);
  const end = endMs;
  const fmt = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16);

  const out = {
    meta: {
      start_ts: start, end_ts: end,
      start_iso: fmt(start), end_iso: fmt(end),
      generated_iso: new Date().toISOString().replace('T', ' ').slice(0, 19),
      hours: Math.round(((end - start) / 3600000) * 10) / 10,
      days: Math.round(((end - start) / 86400000) * 100) / 100,
      device: DEVICE,
    },
    thresholds: {
      TEMP: { min: rangeFor('TEMP').low, max: rangeFor('TEMP').high, unit: GROUP_UNITS.TEMP },
      HUM: { min: rangeFor('HUM').low, max: rangeFor('HUM').high, unit: GROUP_UNITS.HUM },
    },
    current: store.getAll(),
  };

  // --- AlertLog: transiciones y saltos del periodo (ts en segundos) ---
  const startSec = start / 1000;
  const endSec = end / 1000;
  const rows = alertLog
    ? alertLog.query({ sinceTs: startSec, limit: 10000 }).filter((r) => r.ts >= startSec && r.ts <= endSec)
    : [];
  const transitions = rows.filter((r) => r.kind !== 'jump');
  const jumps = rows.filter((r) => r.kind === 'jump');
  const byVar = {};
  for (const r of transitions) byVar[r.var] = (byVar[r.var] || 0) + 1;
  const tsIso = (sec) => new Date(sec * 1000).toISOString().replace('T', ' ').slice(0, 19);
  out.alerts = {
    transitions_total: transitions.length,
    transitions_to_abnormal: transitions.filter((r) => r.new_state === 'abnormal').length,
    transitions_by_var: byVar,
    transitions: transitions.slice(0, 50).map((r) => ({
      ts_iso: tsIso(r.ts), group: r.group_name, var: r.var,
      transition: `${r.prev_state}->${r.new_state}`, value: r.value,
    })),
    jumps_total: jumps.length,
    jumps: jumps.slice(0, 30).map((r) => ({
      ts_iso: tsIso(r.ts), group: r.group_name, var: r.var,
      from_value: r.prev_state, to_value: r.new_state, delta: r.predicted_value,
    })),
  };

  // --- Historico Ubidots: stats + series por sensor ---
  out.history = { TEMP: {}, HUM: {} };
  out.time_series = { TEMP: [], HUM: [] };
  out.aggregations = { TEMP: null, HUM: null };

  if (ubidots) {
    for (const group of ['TEMP', 'HUM']) {
      const vars = varsOfGroup(group);
      const { low, high } = rangeFor(group);
      // Secuencial: el volumen es bajo (8 series) y evita saturar Ubidots.
      for (const { var: varLabel, sensor } of vars) {
        let rowsV = [];
        try {
          rowsV = await ubidots.getValuesRangeByLabel(DEVICE, varLabel, start, end);
        } catch (e) {
          log.warn(`history ${varLabel} fallo: ${e.message}`);
        }
        // Descartar lecturas fisicamente imposibles (sensores descalibrados).
        rowsV = rowsV.filter((r) => isPhysical(r.value, group));
        out.history[group][varLabel] = { sensor, ...statsOf(rowsV, group) };
        out.time_series[group].push({
          var: varLabel, sensor,
          data: rowsV.map((r) => [r.timestamp, round1(r.value)]),
        });
      }
      // Agregaciones sobre el PROMEDIO interior (1 serie limpia).
      out.aggregations[group] = computeAggregations(out.time_series[group], low, high);
    }
  } else {
    log.warn('Sin cliente Ubidots: el reporte no incluira historico ni graficas de tendencia.');
  }

  return out;
}

// Clasifica el snapshot actual del store en una lista de filas por sensor para
// la tabla del reporte (sensor, zona, temp, hum, estados).
export function currentRows(store) {
  return SENSORS.map((s) => {
    const t = s.tempVariable ? store.get(DEVICE, s.tempVariable) : null;
    const h = s.humVariable ? store.get(DEVICE, s.humVariable) : null;
    const tv = t ? t.value : null;
    const hv = h ? h.value : null;
    return {
      sensor: s.sidebarLabel, zone: s.zone,
      temp: round1(tv), temp_state: classify(tv, 'TEMP'),
      hum: round1(hv), hum_state: classify(hv, 'HUM'),
    };
  });
}
