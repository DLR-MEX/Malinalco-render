// Cliente MQTT subscribe-only a Ubidots Industrial. Conecta con el token como
// username, password vacio, y se suscribe al topico /v1.6/devices/{DEVICE}/+/lv
// para capturar todas las variables del device configurado. Cada mensaje se
// parsea, se valida contra VALID_KEYS (sensorsMap.js) y se inyecta al snapshot
// store. El frontend recibe el push via SSE.

import mqtt from 'mqtt';

import {
  MQTT_BROKER, MQTT_PORT, MQTT_TOPIC, UBIDOTS_TOKEN,
  TEMP_VALID_MIN, TEMP_VALID_MAX, HUM_VALID_MIN, HUM_VALID_MAX,
} from './config.js';
import { VALID_KEYS, resolveVariable } from './sensorsMap.js';
import { getLogger } from './logger.js';

const logger = getLogger('mqttClient');

/**
 * Parsea un mensaje del dot completo de Ubidots y retorna
 * {device, variable, value, timestamp} o null.
 *
 * Topico esperado: /v1.6/devices/{device}/{variable}    (sin /lv al final)
 * Payload JSON:    {"value": 25.4, "timestamp": 1715712345678, "context": {...}}
 *
 * Por retrocompatibilidad, tambien acepta el formato legacy /lv (cadena plana
 * sin timestamp). En ese caso el timestamp queda como null y el caller usara
 * Date.now() como fallback.
 */
export function parseLvMessage(topic, payloadRaw) {
  if (!topic || typeof topic !== 'string') return null;
  const parts = topic.replace(/^\/+|\/+$/g, '').split('/');
  if (parts.length < 4) return null;
  if (parts[0] !== 'v1.6' || parts[1] !== 'devices') return null;

  // Detecta formato legacy /lv (5 partes) o dot completo (4 partes).
  const isLegacyLv = parts.length >= 5 && parts[parts.length - 1] === 'lv';
  if (parts.length > 5) return null;
  if (parts.length === 5 && !isLegacyLv) return null;

  const device = parts[2];
  const variable = parts[3];
  if (!VALID_KEYS.has(`${device}/${variable}`)) return null;

  let str;
  try {
    str = (typeof payloadRaw === 'string' ? payloadRaw : payloadRaw.toString('utf-8')).trim();
  } catch {
    logger.warn(`Cannot decode payload for ${device}/${variable}`);
    return null;
  }

  // Formato dot completo (JSON): {"value": ..., "timestamp": ..., "context": ...}
  if (!isLegacyLv && str.startsWith('{')) {
    let dot;
    try {
      dot = JSON.parse(str);
    } catch {
      logger.warn(`Cannot parse JSON dot for ${device}/${variable}: ${str.slice(0, 80)}`);
      return null;
    }
    const value = Number(dot.value);
    if (!Number.isFinite(value)) {
      logger.warn(`Dot sin value numerico para ${device}/${variable}: ${str.slice(0, 80)}`);
      return null;
    }
    // Ubidots timestamp viene en milisegundos desde epoch.
    const tsRaw = Number(dot.timestamp);
    const timestamp = Number.isFinite(tsRaw) && tsRaw > 0 ? tsRaw : null;
    return { device, variable, value, timestamp };
  }

  // Formato legacy /lv: cadena numerica plana.
  const value = Number(str);
  if (!Number.isFinite(value)) {
    logger.warn(`Cannot parse value for ${device}/${variable}: ${str}`);
    return null;
  }
  return { device, variable, value, timestamp: null };
}

/**
 * Devuelve true si el valor cae en el rango fisicamente valido. Inferimos la
 * magnitud por el sufijo del variable label (_temperature / _humidity).
 */
export function isValidReading(variable, value) {
  if (variable.endsWith('_temperature')) {
    return value >= TEMP_VALID_MIN && value <= TEMP_VALID_MAX;
  }
  if (variable.endsWith('_humidity')) {
    return value >= HUM_VALID_MIN && value <= HUM_VALID_MAX;
  }
  return true;
}

export class MqttClient {
  constructor(store) {
    this._store = store;
    this._connected = false;
    this._client = null;
  }

  isConnected() {
    return this._connected;
  }

  start() {
    if (!UBIDOTS_TOKEN) {
      logger.error('UBIDOTS_TOKEN vacio en .env — el cliente MQTT no puede conectar.');
      return;
    }

    const url = `mqtts://${MQTT_BROKER}:${MQTT_PORT}`;
    logger.info(`Connecting to ${MQTT_BROKER}:${MQTT_PORT} ...`);

    this._client = mqtt.connect(url, {
      username: UBIDOTS_TOKEN,
      password: '',
      protocolVersion: 4, // MQTT 3.1.1
      keepalive: 60,
      reconnectPeriod: 1000,
      connectTimeout: 30 * 1000,
    });

    this._client.on('connect', () => {
      this._connected = true;
      logger.info(`Connected to MQTT broker at ${MQTT_BROKER}:${MQTT_PORT}`);
      this._client.subscribe(MQTT_TOPIC, (err) => {
        if (err) {
          logger.error(`Subscribe failed: ${err.message}`);
        } else {
          logger.info(`Subscribed to: ${MQTT_TOPIC}`);
        }
      });
    });

    this._client.on('reconnect', () => {
      logger.warn('MQTT reconnecting...');
    });

    this._client.on('close', () => {
      this._connected = false;
    });

    this._client.on('error', (err) => {
      logger.error(`MQTT error: ${err.message}`);
    });

    this._client.on('message', (topic, payload) => {
      const parsed = parseLvMessage(topic, payload);
      if (!parsed) return;

      const { device, variable, value, timestamp } = parsed;
      if (!isValidReading(variable, value)) {
        logger.warn(`Rejected ${device}/${variable}=${value}: outside valid range`);
        return;
      }

      const resolved = resolveVariable(variable);
      const tag = resolved ? `${resolved.sensor.zone}.${resolved.mode}` : variable;
      // Si el dot trae timestamp del sensor lo usamos; si no, Date.now() como fallback.
      const ts = timestamp ?? Date.now();
      logger.info(`Received ${tag}=${value} (${variable}) @ ${new Date(ts).toISOString()}`);
      this._store.update(device, variable, value, ts);
    });
  }

  stop() {
    if (this._client) {
      this._client.end(true);
      logger.info('MQTT client stopped.');
    }
  }
}
