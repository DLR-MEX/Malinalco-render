import { describe, it, expect, beforeEach } from 'vitest';
import { SnapshotStore } from '../src/snapshotStore.js';
import { ZONES, DEVICE } from '../src/sensorsMap.js';

describe('SnapshotStore', () => {
  let store;
  beforeEach(() => { store = new SnapshotStore(); });

  it('get retorna null si nunca llego', () => {
    expect(store.get(DEVICE, 'sith5_temperature')).toBeNull();
  });

  it('update guarda valor + timestamp', () => {
    store.update(DEVICE, 'sith5_temperature', 25.5, 1700000000000);
    expect(store.get(DEVICE, 'sith5_temperature')).toEqual({
      value: 25.5,
      ts: 1700000000000,
    });
  });

  it('update emite evento change', () => {
    const events = [];
    store.on('change', (e) => events.push(e));
    store.update(DEVICE, 'sfth2_humidity', 80, 1700000000000);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      device: DEVICE,
      variable: 'sfth2_humidity',
      value: 80,
      ts: 1700000000000,
    });
  });

  it('getAll devuelve las 3 zonas con sensores agrupados', () => {
    const snap = store.getAll();
    expect(snap.zones).toHaveLength(ZONES.length);
    for (const z of snap.zones) {
      expect(z).toHaveProperty('id');
      expect(z).toHaveProperty('label');
      expect(z).toHaveProperty('sensors');
      expect(z).toHaveProperty('temp');
      expect(z).toHaveProperty('hum');
    }
  });

  it('cuenta de sensores por zona: engorda=3, desarrollo=1, hab1=2, hab2=2', () => {
    const snap = store.getAll();
    const engorda = snap.zones.find((z) => z.id === 'engorda');
    const desarrollo = snap.zones.find((z) => z.id === 'desarrollo');
    const hab1 = snap.zones.find((z) => z.id === 'hab1');
    const hab2 = snap.zones.find((z) => z.id === 'hab2');
    expect(engorda.sensors).toHaveLength(3);
    expect(desarrollo.sensors).toHaveLength(1);
    expect(hab1.sensors).toHaveLength(2);
    expect(hab2.sensors).toHaveLength(2);
  });

  it('promedio de Habita 1 con 2 sensores de temp', () => {
    store.update(DEVICE, 'sith5_temperature', 22, 1000); // hab1_f
    store.update(DEVICE, 'sfth2_temperature', 24, 1500); // hab1_t
    const hab1 = store.getAll().zones.find((z) => z.id === 'hab1');
    expect(hab1.temp.avg).toBe(23); // (22+24)/2
    expect(hab1.temp.count).toBe(2);
    expect(hab1.temp.capacity).toBe(2);
    expect(hab1.temp.latestTs).toBe(1500);
  });

  it('promedio se calcula solo con sensores que reportaron', () => {
    store.update(DEVICE, 'sith5_humidity', 80, 1000);
    // sfth2_humidity sin reportar
    const hab1 = store.getAll().zones.find((z) => z.id === 'hab1');
    expect(hab1.hum.avg).toBe(80);
    expect(hab1.hum.count).toBe(1);
    expect(hab1.hum.capacity).toBe(2);
  });

  it('Engorda tiene 3 sensores con temp y hum: capacity=3', () => {
    const engorda = store.getAll().zones.find((z) => z.id === 'engorda');
    expect(engorda.temp.capacity).toBe(3);
    expect(engorda.hum.capacity).toBe(3);
    expect(engorda.temp.avg).toBeNull(); // sin datos aun
    expect(engorda.hum.avg).toBeNull();
  });

  it('Habita 2 tiene 2 sensores asignados: capacity=2 para temp y hum', () => {
    const hab2 = store.getAll().zones.find((z) => z.id === 'hab2');
    expect(hab2.temp.capacity).toBe(2);
    expect(hab2.hum.capacity).toBe(2);
  });
});
