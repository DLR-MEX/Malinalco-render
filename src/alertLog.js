// Persistencia local de transiciones de estado de los sensores (SQLite).
//
// El alertMonitor detecta transiciones (ok<->abnormal) y saltos bruscos; aqui
// las escribimos a un SQLite local para poder responder consultas tipo
// "¿hubo anomalias ayer?" desde el agente IA, sin depender de la memoria del
// proceso (sobrevive reinicios).
//
// Portado de ai-predictor/app/alert_log.py. Usa better-sqlite3 (sincrono, sin
// callbacks) — encaja con el flujo del store (escribe en el callback 'change',
// lee en los handlers HTTP). No necesita lock: better-sqlite3 serializa.
//
// Tabla unica `alert_events`:
//   id              INTEGER PRIMARY KEY AUTOINCREMENT
//   ts              REAL    -- epoch SECONDS (igual que el original)
//   group_name      TEXT    -- "TEMP" | "HUM"
//   var             TEXT    -- variable Ubidots (sith3_temperature, ...)
//   prev_state      TEXT    -- "ok" | "abnormal" | "unknown" (o valor num en saltos)
//   new_state       TEXT
//   kind            TEXT    -- "current" | "jump"  (sin "predicted": no hay ML)
//   value           REAL    -- valor actual al momento de la transicion
//   predicted_value REAL    -- en saltos: el delta absoluto

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { getLogger } from './logger.js';

const log = getLogger('alertLog');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS alert_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    ts              REAL NOT NULL,
    group_name      TEXT NOT NULL,
    var             TEXT NOT NULL,
    prev_state      TEXT NOT NULL,
    new_state       TEXT NOT NULL,
    kind            TEXT NOT NULL,
    value           REAL,
    predicted_value REAL
);
CREATE INDEX IF NOT EXISTS idx_alert_events_ts       ON alert_events(ts);
CREATE INDEX IF NOT EXISTS idx_alert_events_group_ts ON alert_events(group_name, ts);
CREATE INDEX IF NOT EXISTS idx_alert_events_var_ts   ON alert_events(var, ts);
`;

export class AlertLog {
  constructor(dbPath) {
    this.dbPath = dbPath;
    // El path puede ser relativo (logs/alerts.db); aseguramos el directorio.
    const dir = path.dirname(dbPath);
    if (dir && dir !== '.' && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this._db = new Database(dbPath);
    this._db.pragma('journal_mode = WAL');
    this._db.exec(SCHEMA);
    this._insert = this._db.prepare(
      `INSERT INTO alert_events
         (ts, group_name, var, prev_state, new_state, kind, value, predicted_value)
       VALUES (@ts, @group_name, @var, @prev_state, @new_state, @kind, @value, @predicted_value)`,
    );
    log.info(`AlertLog en ${dbPath}`);
  }

  /**
   * Escribe una transicion. Llamado desde el alertMonitor (callback del store).
   * @param {object} e { ts (epoch s), group, var, prevState, newState, kind, value?, predictedValue? }
   */
  record({ ts, group, var: varName, prevState, newState, kind, value = null, predictedValue = null }) {
    try {
      this._insert.run({
        ts,
        group_name: group,
        var: varName,
        prev_state: String(prevState),
        new_state: String(newState),
        kind,
        value: value === undefined ? null : value,
        predicted_value: predictedValue === undefined ? null : predictedValue,
      });
    } catch (err) {
      log.warn(`AlertLog.record fallo: ${err.message}`);
    }
  }

  /**
   * SELECT con filtros opcionales. Devuelve filas ordenadas por ts DESC
   * (mas reciente primero). Campos snake_case igual que la tabla.
   */
  query({ group = null, var: varName = null, kind = null, newState = null, sinceTs = null, untilTs = null, limit = 50 } = {}) {
    const clauses = [];
    const params = [];
    if (group) { clauses.push('group_name = ?'); params.push(group); }
    if (varName) { clauses.push('var = ?'); params.push(varName); }
    if (kind) { clauses.push('kind = ?'); params.push(kind); }
    if (newState) { clauses.push('new_state = ?'); params.push(newState); }
    if (sinceTs !== null) { clauses.push('ts >= ?'); params.push(sinceTs); }
    if (untilTs !== null) { clauses.push('ts <= ?'); params.push(untilTs); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const sql = `SELECT * FROM alert_events ${where} ORDER BY ts DESC LIMIT ?`;
    params.push(Math.trunc(limit));
    try {
      return this._db.prepare(sql).all(...params);
    } catch (err) {
      log.warn(`AlertLog.query fallo: ${err.message}`);
      return [];
    }
  }

  /** COUNT con filtros tipicos (cuantas transiciones a abnormal desde X). */
  count({ group = null, newState = null, sinceTs = null } = {}) {
    const clauses = [];
    const params = [];
    if (group) { clauses.push('group_name = ?'); params.push(group); }
    if (newState) { clauses.push('new_state = ?'); params.push(newState); }
    if (sinceTs !== null) { clauses.push('ts >= ?'); params.push(sinceTs); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    try {
      const row = this._db.prepare(`SELECT COUNT(*) AS n FROM alert_events ${where}`).get(...params);
      return row ? Number(row.n) : 0;
    } catch (err) {
      log.warn(`AlertLog.count fallo: ${err.message}`);
      return 0;
    }
  }

  /** Timestamp (epoch s) del registro mas antiguo, o null si esta vacio. */
  oldestTs() {
    try {
      const row = this._db.prepare('SELECT MIN(ts) AS t FROM alert_events').get();
      return row && row.t !== null ? Number(row.t) : null;
    } catch (err) {
      log.warn(`AlertLog.oldestTs fallo: ${err.message}`);
      return null;
    }
  }

  /** Borra registros mas viejos que N dias. Devuelve filas borradas. */
  cleanup(olderThanDays = 30) {
    const cutoff = Date.now() / 1000 - olderThanDays * 86400;
    try {
      const info = this._db.prepare('DELETE FROM alert_events WHERE ts < ?').run(cutoff);
      if (info.changes > 0) {
        log.info(`AlertLog.cleanup borro ${info.changes} filas mas viejas que ${olderThanDays}d`);
      }
      return info.changes;
    } catch (err) {
      log.warn(`AlertLog.cleanup fallo: ${err.message}`);
      return 0;
    }
  }

  close() {
    try { this._db.close(); } catch { /* noop */ }
  }
}
