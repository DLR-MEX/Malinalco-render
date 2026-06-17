// Scheduler de reportes ejecutivos (node-cron + persistencia JSON).
//
// Portado de ai-predictor/app/reports/scheduler.py (que usaba APScheduler +
// SQLAlchemyJobStore). Aqui los jobs se persisten en un JSON simple y se
// re-registran al arrancar — sin dependencias nativas extra.
//
// Cada job al disparar: calcula el rango ('ultimo dia/semana/mes' relativo al
// disparo), genera el PDF y, si deliver_to incluye 'telegram', lo entrega.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import cron from 'node-cron';
import { getLogger } from '../logger.js';
import { SCHEDULES_PATH } from '../config.js';

const log = getLogger('reports.scheduler');

// El cliente solo elige el tipo; el rango se calcula al disparar para que
// "ultimo dia" siempre sean las 24h previas al disparo.
export const PERIOD_KINDS = { daily: 24, weekly: 168, monthly: 720 };

// ---- next-run sin dependencias: matcher de cron (min hora dom mes dow) ----
function parseField(field, min, max) {
  const allowed = new Set();
  for (const part of field.split(',')) {
    let step = 1;
    let range = part;
    if (part.includes('/')) { const [r, s] = part.split('/'); range = r; step = parseInt(s, 10) || 1; }
    let lo = min; let hi = max;
    if (range !== '*') {
      if (range.includes('-')) { const [a, b] = range.split('-'); lo = parseInt(a, 10); hi = parseInt(b, 10); }
      else { lo = parseInt(range, 10); hi = lo; }
    }
    for (let v = lo; v <= hi; v += step) allowed.add(v);
  }
  return allowed;
}

// Devuelve el proximo disparo (Date) de una cron de 5 campos, o null si no hay
// match en ~1 año. Brute force minuto a minuto (solo se llama en add/list).
function nextRun(cronExpr, from = Date.now()) {
  const fields = cronExpr.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minF, hourF, domF, monF, dowF] = fields;
  let mins;
  try {
    mins = parseField(minF, 0, 59);
    var hours = parseField(hourF, 0, 23);
    var doms = parseField(domF, 1, 31);
    var mons = parseField(monF, 1, 12);
    var dows = parseField(dowF, 0, 6);
  } catch { return null; }
  const d = new Date(from);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  const limit = 366 * 24 * 60;
  for (let i = 0; i < limit; i++) {
    if (mins.has(d.getMinutes()) && hours.has(d.getHours())
      && doms.has(d.getDate()) && mons.has(d.getMonth() + 1) && dows.has(d.getDay())) {
      return new Date(d);
    }
    d.setMinutes(d.getMinutes() + 1);
  }
  return null;
}

// Convierte 'diario 8am', 'lunes 9am', 'viernes 6pm' a cron de 5 campos.
export function parseFriendlyCron(spec) {
  const s = (spec || '').toLowerCase().trim();
  let m = s.match(/^diari[oa]\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (m) {
    let h = parseInt(m[1], 10);
    const mm = parseInt(m[2] || '0', 10);
    if (m[3] === 'pm' && h < 12) h += 12;
    if (m[3] === 'am' && h === 12) h = 0;
    return `${mm} ${h} * * *`;
  }
  const dias = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, 'miércoles': 3, jueves: 4, viernes: 5, sabado: 6, 'sábado': 6 };
  m = s.match(new RegExp(`^(?:semanal\\s+)?(${Object.keys(dias).join('|')})\\s+(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?$`));
  if (m) {
    const d = dias[m[1]];
    let h = parseInt(m[2], 10);
    const mm = parseInt(m[3] || '0', 10);
    if (m[4] === 'pm' && h < 12) h += 12;
    if (m[4] === 'am' && h === 12) h = 0;
    return `${mm} ${h} * * ${d}`;
  }
  return null;
}

export class ReportScheduler {
  /**
   * @param {object} o
   * @param {function} o.generate async ({startMs,endMs,title,sendToTelegram}) => card
   * @param {string}   o.schedulesPath ruta del JSON de persistencia
   */
  constructor({ generate, schedulesPath = SCHEDULES_PATH }) {
    this.generate = generate;
    this.path = path.resolve(schedulesPath);
    this._schedules = new Map(); // id -> { schedule_id, name, cron, period_kind, deliver_to, title }
    this._tasks = new Map();     // id -> node-cron task
  }

  // Carga el JSON y registra cada job en node-cron.
  start() {
    let saved = [];
    try {
      if (fs.existsSync(this.path)) saved = JSON.parse(fs.readFileSync(this.path, 'utf-8'));
    } catch (e) {
      log.warn(`No se pudo leer ${this.path}: ${e.message}`);
    }
    for (const s of Array.isArray(saved) ? saved : []) {
      try { this._register(s); } catch (e) { log.warn(`schedule ${s.schedule_id} no se registro: ${e.message}`); }
    }
    log.info(`ReportScheduler iniciado (${this._schedules.size} jobs en ${this.path})`);
  }

  _register(s) {
    if (!cron.validate(s.cron)) throw new Error(`cron invalido: ${s.cron}`);
    const task = cron.schedule(s.cron, () => this._run(s.schedule_id));
    this._schedules.set(s.schedule_id, s);
    this._tasks.set(s.schedule_id, task);
  }

  _persist() {
    const dir = path.dirname(this.path);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.path, JSON.stringify([...this._schedules.values()], null, 2));
  }

  async _run(scheduleId) {
    const s = this._schedules.get(scheduleId);
    if (!s) return;
    const hours = PERIOD_KINDS[s.period_kind] || 24;
    const endMs = Date.now();
    const startMs = endMs - hours * 3600 * 1000;
    const deliverTo = s.deliver_to || ['disk'];
    log.info(`Job '${scheduleId}' (${s.name}) disparo: ${hours}h, deliver_to=${deliverTo.join(',')}`);
    try {
      const card = await this.generate({
        startMs, endMs, title: s.title || `Reporte ${s.name}`,
        sendToTelegram: deliverTo.includes('telegram'),
      });
      log.info(`Job '${scheduleId}' genero ${card.filename} (${card.size_kb}KB)`);
    } catch (e) {
      log.error(`Job '${scheduleId}' fallo: ${e.message}`);
    }
  }

  // Registra un nuevo schedule. cron o friendlyCron (uno requerido).
  add({ name, cron: cronExpr, friendlyCron, periodKind = 'daily', deliverTo = ['disk'], title = null }) {
    if (!name || !name.trim()) throw new Error('name requerido');
    if (!(periodKind in PERIOD_KINDS)) throw new Error(`period_kind invalido: ${periodKind}. Valores: ${Object.keys(PERIOD_KINDS).join(', ')}`);
    for (const d of deliverTo) {
      if (d !== 'disk' && d !== 'telegram') throw new Error(`deliver_to invalido: ${d}. Valores: 'disk', 'telegram'`);
    }
    let expr = (cronExpr || '').trim();
    if (!expr && friendlyCron) {
      expr = parseFriendlyCron(friendlyCron);
      if (!expr) throw new Error(`No reconozco '${friendlyCron}'. Ej: 'diario 8am', 'lunes 9am', 'viernes 6pm'.`);
    }
    if (!expr) throw new Error('Debes proporcionar cron o friendlyCron');
    if (!cron.validate(expr)) throw new Error(`cron invalido: ${expr}`);

    const scheduleId = `report_${crypto.randomBytes(5).toString('hex')}`;
    const entry = { schedule_id: scheduleId, name: name.trim(), cron: expr, period_kind: periodKind, deliver_to: deliverTo, title };
    this._register(entry);
    this._persist();
    const next = nextRun(expr);
    log.info(`Schedule '${scheduleId}' agregado (cron='${expr}', next=${next ? next.toISOString() : '?'})`);
    return { ...entry, next_run_iso: next ? next.toISOString() : null };
  }

  list() {
    return [...this._schedules.values()].map((s) => {
      const next = nextRun(s.cron);
      return { ...s, next_run_iso: next ? next.toISOString() : null };
    });
  }

  remove(scheduleId) {
    const task = this._tasks.get(scheduleId);
    if (!task) return false;
    task.stop();
    this._tasks.delete(scheduleId);
    this._schedules.delete(scheduleId);
    this._persist();
    log.info(`Schedule '${scheduleId}' removido`);
    return true;
  }

  stop() {
    for (const task of this._tasks.values()) {
      try { task.stop(); } catch { /* noop */ }
    }
  }
}
