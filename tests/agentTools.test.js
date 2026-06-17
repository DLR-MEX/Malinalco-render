import { describe, it, expect } from 'vitest';
import { classify, classifyHysteresis, rangeFor } from '../src/thresholds.js';
import { SnapshotStore } from '../src/snapshotStore.js';
import { createTools } from '../src/agent/tools.js';
import { DEVICE } from '../src/sensorsMap.js';

describe('thresholds.classify', () => {
  it('marca unknown sin valor', () => {
    expect(classify(null, 'TEMP')).toBe('unknown');
    expect(classify(undefined, 'HUM')).toBe('unknown');
    expect(classify(NaN, 'TEMP')).toBe('unknown');
  });

  it('clasifica TEMP contra 22-32', () => {
    const { low, high } = rangeFor('TEMP');
    expect(low).toBe(22); expect(high).toBe(32);
    expect(classify(27, 'TEMP')).toBe('ok');
    expect(classify(21.9, 'TEMP')).toBe('abnormal');
    expect(classify(40, 'TEMP')).toBe('abnormal');
  });

  it('clasifica HUM contra 50-80', () => {
    expect(classify(65, 'HUM')).toBe('ok');
    expect(classify(30, 'HUM')).toBe('abnormal');
    expect(classify(95, 'HUM')).toBe('abnormal');
  });
});

describe('thresholds.classifyHysteresis', () => {
  it('no apaga la alerta dentro de la banda muerta', () => {
    // Rango HUM 50-80, banda = 0.9. Estaba abnormal; 50.5 aun no entra del todo.
    expect(classifyHysteresis(50.5, 'HUM', 'abnormal')).toBe('abnormal');
    // Entra claramente: vuelve a ok
    expect(classifyHysteresis(55, 'HUM', 'abnormal')).toBe('ok');
  });

  it('no prende la alerta por un roce del umbral', () => {
    // Estaba ok; 32.1 esta dentro de la banda muerta superior -> sigue ok
    expect(classifyHysteresis(32.1, 'TEMP', 'ok')).toBe('ok');
    // Sale claramente -> abnormal
    expect(classifyHysteresis(34, 'TEMP', 'ok')).toBe('abnormal');
  });
});

describe('createTools (Fase 1)', () => {
  it('expone get_current_state y get_thresholds', () => {
    const tools = createTools({ store: new SnapshotStore() });
    const names = tools.schemas.map((s) => s.function.name);
    expect(names).toContain('get_current_state');
    expect(names).toContain('get_thresholds');
  });

  it('get_current_state agrupa por zona con estado clasificado', async () => {
    const store = new SnapshotStore();
    store.update(DEVICE, 'sith3_temperature', 27); // eng_c ok
    store.update(DEVICE, 'sfth3_temperature', 40); // eng_n abnormal
    const tools = createTools({ store });
    const st = await tools.execute('get_current_state', {});
    const engorda = st.zones.find((z) => z.id === 'engorda');
    const engC = engorda.sensors.find((s) => s.id === 'eng_c');
    const engN = engorda.sensors.find((s) => s.id === 'eng_n');
    expect(engC.temp.state).toBe('ok');
    expect(engN.temp.state).toBe('abnormal');
  });

  it('tool desconocida devuelve error', async () => {
    const tools = createTools({ store: new SnapshotStore() });
    expect(await tools.execute('nope', {})).toEqual({ error: 'tool desconocida: nope' });
  });
});

describe('createTools (Fase 3: get_recent_alerts)', () => {
  function fakeAlertLog(rows) {
    const nowSec = Date.now() / 1000;
    return {
      query: () => rows,
      count: ({ newState }) => rows.filter((r) => r.kind !== 'jump' && (!newState || r.new_state === newState)).length,
      oldestTs: () => nowSec - 100000,
    };
  }

  it('solo se registra cuando hay alertLog', () => {
    const sinLog = createTools({ store: new SnapshotStore() });
    expect(sinLog.schemas.map((s) => s.function.name)).not.toContain('get_recent_alerts');
    const conLog = createTools({ store: new SnapshotStore(), alertLog: fakeAlertLog([]) });
    expect(conLog.schemas.map((s) => s.function.name)).toContain('get_recent_alerts');
  });

  it('separa transiciones de saltos y reporta abnormal actual', async () => {
    const nowSec = Date.now() / 1000;
    const rows = [
      { ts: nowSec - 100, group_name: 'TEMP', var: 'sith3_temperature', prev_state: 'ok', new_state: 'abnormal', kind: 'current', value: 40 },
      { ts: nowSec - 50, group_name: 'TEMP', var: 'sith3_temperature', prev_state: '25.0', new_state: '27.0', kind: 'jump', value: 27, predicted_value: 2 },
    ];
    const store = new SnapshotStore();
    store.update(DEVICE, 'sith4_humidity', 95); // hab2_s: HUM abnormal AHORA
    const tools = createTools({ store, alertLog: fakeAlertLog(rows) });
    const r = await tools.execute('get_recent_alerts', { hours: 24 });
    expect(r.transitions_returned).toBe(1);
    expect(r.transitions[0].transition).toBe('ok->abnormal');
    expect(r.jumps_detected).toBe(1);
    expect(r.jumps[0].delta).toBe(2);
    expect(r.transitions_to_abnormal).toBe(1);
    const abnormalVars = r.currently_abnormal_sensors.map((s) => s.var);
    expect(abnormalVars).toContain('sith4_humidity');
  });
});

describe('createTools (Fase 4: reportes)', () => {
  const fakeReports = { generate: async () => ({ report_id: 'x' }), list: () => [], filePath: () => null };
  const fakeScheduler = { add: () => ({}), list: () => [], remove: () => true };

  it('registra generate_report solo con ReportsService', () => {
    const sin = createTools({ store: new SnapshotStore() });
    expect(sin.schemas.map((s) => s.function.name)).not.toContain('generate_report');
    const con = createTools({ store: new SnapshotStore(), reports: fakeReports });
    expect(con.schemas.map((s) => s.function.name)).toContain('generate_report');
  });

  it('registra las tools de scheduling solo con scheduler', () => {
    const con = createTools({ store: new SnapshotStore(), scheduler: fakeScheduler });
    const names = con.schemas.map((s) => s.function.name);
    expect(names).toContain('schedule_report');
    expect(names).toContain('list_scheduled_reports');
    expect(names).toContain('cancel_report_schedule');
  });
});
