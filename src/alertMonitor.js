// Monitor de alertas: se suscribe al evento 'change' del store y, por cada
// lectura, (1) clasifica con histeresis y registra las transiciones ok<->abnormal
// en el AlertLog + dispara Telegram, y (2) detecta saltos bruscos entre lecturas
// consecutivas del mismo sensor (rate-of-change).
//
// Portado de ai-predictor/app/service.py::TelegramNotifier.on_alerts +
// RateOfChangeDetector, fusionados aqui porque en Malinalco un solo callback del
// store recibe cada lectura individual (en Tenebrios venian por grupos).
//
// Diferencias con el original:
//   - Sin sensores exteriores (tex/hex): Malinalco no los tiene, no se filtra nada.
//   - Sin estado "predicted" (no hay modelo ML): solo kind 'current' y 'jump'.
//   - El AlertLog guarda ts en epoch SEGUNDOS (el store emite ms); convertimos.

import { getLogger } from './logger.js';
import { classifyHysteresis } from './thresholds.js';
import { JUMP_TEMP, JUMP_HUM } from './config.js';

const log = getLogger('alertMonitor');

const JUMP_THRESHOLDS = { TEMP: JUMP_TEMP, HUM: JUMP_HUM };
const MAX_GAP_MS = 5 * 60 * 1000;   // si la muestra previa es > 5min, no comparamos
const JUMP_COOLDOWN_MS = 5 * 60 * 1000; // por sensor, para no spamear saltos

// Grupo (TEMP/HUM) a partir del sufijo de la variable Ubidots.
function groupOfVar(label) {
  if (label.endsWith('_temperature')) return 'TEMP';
  if (label.endsWith('_humidity')) return 'HUM';
  return null;
}

export class AlertMonitor {
  constructor({ store, alertLog = null, telegram = null }) {
    this.store = store;
    this.alertLog = alertLog;
    this.telegram = telegram;
    this._prevState = new Map(); // var -> 'ok'|'abnormal'|'unknown'
    this._lastSeen = new Map();  // var -> { ts(ms), value }  (para saltos)
    this._lastJump = new Map();  // var -> ts(ms)
    this._onChange = (evt) => this.observe(evt);
    store.on('change', this._onChange);
    log.info('AlertMonitor activo (suscrito al store)');
  }

  // evt = { device, variable, value, ts } con ts en epoch ms.
  observe(evt) {
    const { variable, value, ts } = evt;
    const group = groupOfVar(variable);
    if (!group) return;
    const tsSec = ts / 1000;

    // 1) Transicion de estado con histeresis.
    const prev = this._prevState.get(variable);
    const newState = classifyHysteresis(value, group, prev);
    this._prevState.set(variable, newState);

    // Solo registramos/notificamos si habia estado previo y cambio (igual que
    // el original: la primera lectura solo "siembra" el estado).
    if (prev !== undefined && prev !== newState) {
      if (this.alertLog) {
        this.alertLog.record({
          ts: tsSec, group, var: variable,
          prevState: prev, newState, kind: 'current', value,
        });
      }
      if (this.telegram) {
        this.telegram.notifyTransition({ group, var: variable, value, prevState: prev, newState, ts });
      }
      log.info(`transicion ${variable} (${group}): ${prev} -> ${newState} (${value})`);
    }

    // 2) Salto brusco entre lecturas consecutivas (rate-of-change).
    this._detectJump(group, variable, value, ts, tsSec);
  }

  _detectJump(group, variable, value, ts, tsSec) {
    const threshold = JUMP_THRESHOLDS[group];
    const prevSeen = this._lastSeen.get(variable);
    this._lastSeen.set(variable, { ts, value });
    if (threshold === undefined || prevSeen === undefined) return;

    const dt = ts - prevSeen.ts;
    if (dt <= 0 || dt > MAX_GAP_MS) return;
    const delta = value - prevSeen.value;
    if (Math.abs(delta) < threshold) return;

    const lastJump = this._lastJump.get(variable);
    if (lastJump !== undefined && ts - lastJump < JUMP_COOLDOWN_MS) return;
    this._lastJump.set(variable, ts);

    const dir = delta > 0 ? 'subida' : 'bajada';
    log.warn(`SALTO ${dir} en ${variable} (${group}): ${prevSeen.value.toFixed(2)} -> ${value.toFixed(2)} (delta ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}, umbral ${threshold})`);
    if (this.alertLog) {
      this.alertLog.record({
        ts: tsSec, group, var: variable,
        prevState: prevSeen.value.toFixed(2),
        newState: value.toFixed(2),
        kind: 'jump',
        value,
        predictedValue: delta, // delta en el campo predicted_value (igual que el original)
      });
    }
  }

  stop() {
    if (this._onChange) this.store.removeListener('change', this._onChange);
  }
}
