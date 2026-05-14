import { describe, it, expect } from 'vitest';
import { parseLvMessage, isValidReading } from '../src/mqttClient.js';
import { DEVICE } from '../src/sensorsMap.js';

describe('parseLvMessage — formato dot completo (JSON)', () => {
  it('parsea topico sin /lv con payload JSON {value, timestamp}', () => {
    const payload = JSON.stringify({ value: 25.4, timestamp: 1715712345678, context: {} });
    const r = parseLvMessage(`/v1.6/devices/${DEVICE}/sith5_temperature`, payload);
    expect(r).toEqual({
      device: DEVICE,
      variable: 'sith5_temperature',
      value: 25.4,
      timestamp: 1715712345678,
    });
  });

  it('parsea variable de humedad con timestamp', () => {
    const payload = JSON.stringify({ value: 78, timestamp: 1715712000000 });
    const r = parseLvMessage(`/v1.6/devices/${DEVICE}/sfth2_humidity`, payload);
    expect(r).toEqual({
      device: DEVICE,
      variable: 'sfth2_humidity',
      value: 78,
      timestamp: 1715712000000,
    });
  });

  it('acepta payload JSON como Buffer', () => {
    const payload = Buffer.from(JSON.stringify({ value: 27.1, timestamp: 1715712111111 }));
    const r = parseLvMessage(`/v1.6/devices/${DEVICE}/sfth2_temperature`, payload);
    expect(r).toEqual({
      device: DEVICE,
      variable: 'sfth2_temperature',
      value: 27.1,
      timestamp: 1715712111111,
    });
  });

  it('rechaza JSON sin value numerico', () => {
    const payload = JSON.stringify({ timestamp: 1715712345678 });
    expect(parseLvMessage(`/v1.6/devices/${DEVICE}/sith5_temperature`, payload)).toBeNull();
  });

  it('timestamp = null si el dot no lo trae', () => {
    const payload = JSON.stringify({ value: 23.5 });
    const r = parseLvMessage(`/v1.6/devices/${DEVICE}/sith5_temperature`, payload);
    expect(r).toEqual({
      device: DEVICE,
      variable: 'sith5_temperature',
      value: 23.5,
      timestamp: null,
    });
  });

  it('rechaza JSON mal formado', () => {
    expect(parseLvMessage(`/v1.6/devices/${DEVICE}/sith5_temperature`, '{not json}')).toBeNull();
  });
});

describe('parseLvMessage — retrocompatibilidad formato /lv (cadena plana)', () => {
  it('parsea topico /lv legacy con timestamp = null', () => {
    const r = parseLvMessage(`/v1.6/devices/${DEVICE}/sith5_temperature/lv`, '25.4');
    expect(r).toEqual({
      device: DEVICE,
      variable: 'sith5_temperature',
      value: 25.4,
      timestamp: null,
    });
  });

  it('acepta payload Buffer en /lv', () => {
    const r = parseLvMessage(`/v1.6/devices/${DEVICE}/sfth2_temperature/lv`, Buffer.from('27.1'));
    expect(r).toEqual({
      device: DEVICE,
      variable: 'sfth2_temperature',
      value: 27.1,
      timestamp: null,
    });
  });

  it('rechaza /lv con payload no numerico', () => {
    expect(parseLvMessage(`/v1.6/devices/${DEVICE}/sith5_temperature/lv`, 'hola')).toBeNull();
  });
});

describe('parseLvMessage — validacion de topico', () => {
  it('rechaza device desconocido', () => {
    const payload = JSON.stringify({ value: 25, timestamp: 1 });
    expect(parseLvMessage('/v1.6/devices/otro_device/sith5_temperature', payload)).toBeNull();
  });

  it('rechaza topico mal formado', () => {
    expect(parseLvMessage('algo/random', '25')).toBeNull();
    expect(parseLvMessage('', '25')).toBeNull();
    expect(parseLvMessage(null, '25')).toBeNull();
  });

  it('rechaza topico que no empieza por v1.6/devices', () => {
    expect(parseLvMessage(`/v2.0/devices/${DEVICE}/sith5_temperature`, '{}')).toBeNull();
  });

  it('tolera slashes iniciales/finales', () => {
    const payload = JSON.stringify({ value: 25, timestamp: 1715000000000 });
    const r = parseLvMessage(`/v1.6/devices/${DEVICE}/sith5_temperature/`, payload);
    expect(r).toEqual({
      device: DEVICE,
      variable: 'sith5_temperature',
      value: 25,
      timestamp: 1715000000000,
    });
  });

  it('acepta variables de todas las zonas configuradas', () => {
    const variables = [
      'sith3_humidity',    // engorda
      'sico2_temperature', // desarrollo
      'sico2_humidity',
      'sith4_temperature', // hab2_s
    ];
    for (const v of variables) {
      const payload = JSON.stringify({ value: 50, timestamp: 1 });
      const r = parseLvMessage(`/v1.6/devices/${DEVICE}/${v}`, payload);
      expect(r).toMatchObject({ device: DEVICE, variable: v, value: 50, timestamp: 1 });
    }
  });
});

describe('isValidReading', () => {
  it('acepta temperaturas en rango por sufijo _temperature', () => {
    expect(isValidReading('sith5_temperature', 25)).toBe(true);
    expect(isValidReading('sfth2_temperature', -10)).toBe(true);
    expect(isValidReading('sith5_temperature', 80)).toBe(true);
  });

  it('rechaza temperaturas absurdas', () => {
    expect(isValidReading('sith5_temperature', -50)).toBe(false);
    expect(isValidReading('sith5_temperature', 999)).toBe(false);
  });

  it('acepta humedad 0-100 por sufijo _humidity', () => {
    expect(isValidReading('sith5_humidity', 0)).toBe(true);
    expect(isValidReading('sfth2_humidity', 50)).toBe(true);
    expect(isValidReading('sith5_humidity', 100)).toBe(true);
  });

  it('rechaza humedad fuera de 0-100', () => {
    expect(isValidReading('sith5_humidity', -1)).toBe(false);
    expect(isValidReading('sfth2_humidity', 101)).toBe(false);
  });

  it('acepta cualquier valor si la variable no tiene sufijo conocido', () => {
    expect(isValidReading('algo_random', 9999)).toBe(true);
  });
});
