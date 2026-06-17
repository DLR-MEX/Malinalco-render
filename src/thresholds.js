// Clasificacion de lecturas contra los rangos optimos. Reutilizado por las
// tools del agente (estado actual / historico) y por el alertMonitor (Fase 3).
//
// Grupos: 'TEMP' (°C) y 'HUM' (%). Una lectura es:
//   - 'unknown'  si no hay valor (null/undefined/NaN)
//   - 'abnormal' si esta fuera de [low, high]
//   - 'ok'       en otro caso

import {
  TEMP_ALERT_LOW, TEMP_ALERT_HIGH, HUM_ALERT_LOW, HUM_ALERT_HIGH,
} from './config.js';

export const GROUP_UNITS = { TEMP: '°C', HUM: '%' };
export const GROUP_LABELS = { TEMP: 'Temperatura', HUM: 'Humedad' };

export function rangeFor(group) {
  return group === 'TEMP'
    ? { low: TEMP_ALERT_LOW, high: TEMP_ALERT_HIGH }
    : { low: HUM_ALERT_LOW, high: HUM_ALERT_HIGH };
}

export function classify(value, group) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'unknown';
  const { low, high } = rangeFor(group);
  return value < low || value > high ? 'abnormal' : 'ok';
}

// Histeresis: evita que una alerta se prenda/apague cuando el valor oscila
// justo en la frontera del umbral. Usa una banda muerta del 3% del rango.
// Portado de classify_hysteresis (service.py de Tenebrios).
export function classifyHysteresis(value, group, prevState) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'unknown';
  const { low, high } = rangeFor(group);
  const band = (high - low) * 0.03;
  if (prevState === 'abnormal') {
    // Para volver a 'ok' debe entrar claramente dentro del rango.
    return value >= low + band && value <= high - band ? 'ok' : 'abnormal';
  }
  // Para pasar a 'abnormal' debe salir claramente del rango.
  return value < low - band || value > high + band ? 'abnormal' : 'ok';
}
