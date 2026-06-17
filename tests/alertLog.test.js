import {
  describe, it, expect, beforeEach, afterEach,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AlertLog } from '../src/alertLog.js';

describe('AlertLog', () => {
  let dbPath;
  let alog;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `mal-alerts-${process.pid}-${Math.floor(performance.now() * 1000)}.db`);
    alog = new AlertLog(dbPath);
  });

  afterEach(() => {
    alog.close();
    for (const ext of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(dbPath + ext); } catch { /* noop */ }
    }
  });

  it('record + query devuelve la fila (ts DESC)', () => {
    alog.record({ ts: 100, group: 'TEMP', var: 'sith3_temperature', prevState: 'ok', newState: 'abnormal', kind: 'current', value: 40 });
    alog.record({ ts: 200, group: 'HUM', var: 'sith3_humidity', prevState: 'ok', newState: 'abnormal', kind: 'current', value: 95 });
    const rows = alog.query({});
    expect(rows).toHaveLength(2);
    expect(rows[0].ts).toBe(200); // mas reciente primero
    expect(rows[0].var).toBe('sith3_humidity');
    expect(rows[1].new_state).toBe('abnormal');
  });

  it('filtra por group, var y kind', () => {
    alog.record({ ts: 1, group: 'TEMP', var: 'a_temperature', prevState: 'ok', newState: 'abnormal', kind: 'current', value: 40 });
    alog.record({ ts: 2, group: 'TEMP', var: 'a_temperature', prevState: '25.0', newState: '26.0', kind: 'jump', value: 26, predictedValue: 1 });
    alog.record({ ts: 3, group: 'HUM', var: 'b_humidity', prevState: 'ok', newState: 'abnormal', kind: 'current', value: 95 });
    expect(alog.query({ group: 'TEMP' })).toHaveLength(2);
    expect(alog.query({ var: 'b_humidity' })).toHaveLength(1);
    expect(alog.query({ kind: 'jump' })).toHaveLength(1);
    expect(alog.query({ kind: 'jump' })[0].predicted_value).toBe(1);
  });

  it('count cuenta transiciones a abnormal desde un ts', () => {
    alog.record({ ts: 10, group: 'TEMP', var: 'x_temperature', prevState: 'ok', newState: 'abnormal', kind: 'current', value: 40 });
    alog.record({ ts: 20, group: 'TEMP', var: 'x_temperature', prevState: 'abnormal', newState: 'ok', kind: 'current', value: 25 });
    alog.record({ ts: 30, group: 'TEMP', var: 'x_temperature', prevState: 'ok', newState: 'abnormal', kind: 'current', value: 41 });
    expect(alog.count({ newState: 'abnormal' })).toBe(2);
    expect(alog.count({ newState: 'abnormal', sinceTs: 25 })).toBe(1);
  });

  it('oldestTs es null vacio y el menor ts con datos', () => {
    expect(alog.oldestTs()).toBeNull();
    alog.record({ ts: 500, group: 'HUM', var: 'h', prevState: 'ok', newState: 'abnormal', kind: 'current', value: 90 });
    alog.record({ ts: 300, group: 'HUM', var: 'h', prevState: 'ok', newState: 'abnormal', kind: 'current', value: 91 });
    expect(alog.oldestTs()).toBe(300);
  });
});
