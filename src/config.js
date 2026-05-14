// Constantes del sistema y carga del .env. Todos los valores ajustables viven
// aqui o en sensorsMap.js. No hay constantes hardcodeadas en otros modulos.

import 'dotenv/config';

// --- Ubidots / MQTT ---
export const UBIDOTS_TOKEN = process.env.UBIDOTS_TOKEN || '';
export const UBIDOTS_DEVICE = process.env.UBIDOTS_DEVICE || 'prueba_lora';
export const MQTT_BROKER = process.env.MQTT_BROKER || 'industrial.api.ubidots.com';
export const MQTT_PORT = parseInt(process.env.MQTT_PORT || '8883', 10);

// Topico wildcard que captura todas las variables del device configurado.
// Usamos el tópico sin "/lv": Ubidots publica el dot completo como JSON
// ({value, timestamp, context}), con el timestamp real generado por el sensor.
// El parser filtra contra VALID_KEYS de sensorsMap.js.
export const MQTT_TOPIC = `/v1.6/devices/${UBIDOTS_DEVICE}/+`;

// --- Servidor web ---
export const WEB_HOST = process.env.WEB_HOST || '0.0.0.0';
export const WEB_PORT = parseInt(process.env.WEB_PORT || '5000', 10);

// --- Rangos para colorscale (defaults Malinalco) ---
export const TEMP_MIN = 10.0;
export const TEMP_MAX = 45.0;
export const HUM_MIN = 0.0;
export const HUM_MAX = 100.0;

// Rango fisico valido para descartar lecturas absurdas antes de actualizar el store.
export const TEMP_VALID_MIN = -10.0;
export const TEMP_VALID_MAX = 80.0;
export const HUM_VALID_MIN = 0.0;
export const HUM_VALID_MAX = 100.0;

// --- Umbrales de alerta por antiguedad del dato (minutos) ---
// Ambar: el ultimo valor es viejo pero aceptable. Rojo: hay un problema.
export const ALERT_WARN_MIN = 5;
export const ALERT_ERROR_MIN = 30;

// --- Rangos ideales por magnitud (alerta si esta fuera) ---
// Temperatura: zona ideal 22-32 C, target medio 27 C. Fuera: muy frio / muy caliente.
export const TEMP_ALERT_LOW = 22;
export const TEMP_ALERT_HIGH = 32;
// Humedad: rango aceptable 50-80%, ideal 70%. Fuera: baja / alta humedad.
export const HUM_ALERT_LOW = 50;
export const HUM_ALERT_HIGH = 80;

// --- Logging ---
export const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

// --- Modo mock para Fase 1 (sin Ubidots real) ---
export const MOCK_DATA = (process.env.MOCK_DATA || 'false').toLowerCase() === 'true';
export const MOCK_INTERVAL_MS = 2000;
