import { describe, it, expect, beforeEach } from 'vitest';
import { SnapshotStore } from '../src/snapshotStore.js';
import { AlertMonitor } from '../src/alertMonitor.js';
import { DEVICE } from '../src/sensorsMap.js';

// Fakes: capturan lo que el monitor escribe sin tocar SQLite ni la red.
function fakeAlertLog() {
  const rows = [];
  return { rows, record: (e) => rows.push(e) };
}
function fakeTelegram() {
  const calls = [];
  return { calls, notifyTransition: (e) => calls.push(e) };
}

describe('AlertMonitor', () => {
  let store;
  beforeEach(() => { store = new SnapshotStore(); });

  it('registra transicion ok->abnormal y notifica Telegram', () => {
    const alog = fakeAlertLog();
    const tg = fakeTelegram();
    new AlertMonitor({ store, alertLog: alog, telegram: tg });

    store.update(DEVICE, 'sith3_temperature', 27, 1000); // siembra estado ok
    store.update(DEVICE, 'sith3_temperature', 40, 2000); // ok -> abnormal

    const transitions = alog.rows.filter((r) => r.kind === 'current');
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({
      group: 'TEMP', var: 'sith3_temperature', prevState: 'ok', newState: 'abnormal',
    });
    expect(transitions[0].ts).toBe(2); // ms -> segundos
    expect(tg.calls).toHaveLength(1);
    expect(tg.calls[0].newState).toBe('abnormal');
  });

  it('la primera lectura solo siembra (no registra ni notifica)', () => {
    const alog = fakeAlertLog();
    const tg = fakeTelegram();
    new AlertMonitor({ store, alertLog: alog, telegram: tg });
    store.update(DEVICE, 'sith3_temperature', 40, 1000); // abnormal pero es la 1a
    expect(alog.rows.filter((r) => r.kind === 'current')).toHaveLength(0);
    expect(tg.calls).toHaveLength(0);
  });

  it('detecta salto brusco aunque no cambie el estado', () => {
    const alog = fakeAlertLog();
    new AlertMonitor({ store, alertLog: alog, telegram: null });
    store.update(DEVICE, 'sith3_temperature', 27, 1000);   // seed
    store.update(DEVICE, 'sith3_temperature', 28.6, 2000); // delta 1.6 > 0.5, sigue ok
    const jumps = alog.rows.filter((r) => r.kind === 'jump');
    expect(jumps).toHaveLength(1);
    expect(jumps[0].var).toBe('sith3_temperature');
    expect(Math.abs(jumps[0].predictedValue - 1.6)).toBeLessThan(1e-9);
  });

  it('no detecta salto si el gap entre lecturas es muy grande (>5min)', () => {
    const alog = fakeAlertLog();
    new AlertMonitor({ store, alertLog: alog, telegram: null });
    store.update(DEVICE, 'sith3_temperature', 27, 1000);
    store.update(DEVICE, 'sith3_temperature', 35, 1000 + 6 * 60 * 1000); // 6 min despues
    expect(alog.rows.filter((r) => r.kind === 'jump')).toHaveLength(0);
  });

  it('ignora variables que no son temp/hum', () => {
    const alog = fakeAlertLog();
    new AlertMonitor({ store, alertLog: alog, telegram: null });
    store.update(DEVICE, 'algo_raro', 999, 1000);
    store.update(DEVICE, 'algo_raro', 0, 2000);
    expect(alog.rows).toHaveLength(0);
  });
});
