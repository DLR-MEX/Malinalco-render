// Constantes del sistema y carga del .env. Todos los valores ajustables viven
// aqui o en sensorsMap.js. No hay constantes hardcodeadas en otros modulos.

import 'dotenv/config';

// --- Ubidots / MQTT ---
export const UBIDOTS_TOKEN = process.env.UBIDOTS_TOKEN || '';
export const UBIDOTS_DEVICE = process.env.UBIDOTS_DEVICE || 'prueba_lora';
export const MQTT_BROKER = process.env.MQTT_BROKER || 'industrial.api.ubidots.com';
// TLS del broker: true => mqtts:// (8883), false => mqtt:// plano (1883).
// Acepta el nombre Malinalco (MQTT_TLS) o el de Tenebrios (UBIDOTS_TLS).
export const MQTT_TLS = String(process.env.MQTT_TLS ?? process.env.UBIDOTS_TLS ?? 'true').toLowerCase() === 'true';
// Puerto: si no se especifica, default segun TLS (8883 con TLS, 1883 sin TLS).
export const MQTT_PORT = parseInt(process.env.MQTT_PORT || process.env.UBIDOTS_PORT || (MQTT_TLS ? '8883' : '1883'), 10);

// API REST de Ubidots (para el historico que consulta el agente IA).
export const UBIDOTS_HTTP_BASE = process.env.UBIDOTS_HTTP_BASE || 'https://industrial.api.ubidots.com';

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

// --- Agente IA conversacional (Ollama Cloud) ---
// Si AGENT_ENABLED=true y hay OLLAMA_API_KEY, se expone POST /api/agent/chat
// para preguntas en lenguaje natural sobre el complejo. Sin API key, el agente
// queda inactivo (no rompe el resto del dashboard).
export const AGENT_ENABLED = (process.env.AGENT_ENABLED || 'true').toLowerCase() === 'true';
export const OLLAMA_HOST = process.env.OLLAMA_HOST || 'https://ollama.com';
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gpt-oss:120b';
export const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY || '';

// --- Alert log (transiciones ok<->abnormal) ---
// SQLite local (better-sqlite3) que persiste cada transicion de estado para que
// el agente IA pueda responder "¿hubo anomalias hoy?" aunque el proceso se haya
// reiniciado. El alertMonitor lo escribe; la tool get_recent_alerts lo lee.
export const ALERT_DB_PATH = process.env.ALERT_DB_PATH || 'logs/alerts.db';
// Detector de saltos (rate-of-change): delta minimo entre lecturas consecutivas
// del mismo sensor para considerarlo "salto brusco". Reusa el rango optimo para
// las transiciones; estos son solo para el detector de cambios abruptos.
export const JUMP_TEMP = parseFloat(process.env.JUMP_TEMP || '0.5'); // °C
export const JUMP_HUM = parseFloat(process.env.JUMP_HUM || '5');     // %

// --- Telegram (alertas + entrega de reportes) ---
// El bot_token SOLO vive aqui (.env), nunca se acepta por API. Si falta token o
// chat_id, el notifier queda inactivo (no-op) y el resto del sistema funciona.
export const TELEGRAM_ENABLED = (process.env.TELEGRAM_ENABLED || 'false').toLowerCase() === 'true';
export const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
export const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
export const TELEGRAM_COOLDOWN_SEC = parseFloat(process.env.TELEGRAM_COOLDOWN_SEC || '300');

// --- Reportes PDF + scheduler (Fase 4) ---
// puppeteer renderiza HTML->PDF headless. En la Raspberry Pi conviene usar el
// Chromium del sistema via PUPPETEER_EXECUTABLE_PATH en vez del que descarga npm.
export const REPORTS_ENABLED = (process.env.REPORTS_ENABLED || 'true').toLowerCase() === 'true';
export const REPORTS_DIR = process.env.REPORTS_DIR || 'reports';
export const SCHEDULES_PATH = process.env.SCHEDULES_PATH || 'reports/schedules.json';
export const PUPPETEER_EXECUTABLE_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || '';

// --- Logging ---
export const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

// --- Modo mock para Fase 1 (sin Ubidots real) ---
export const MOCK_DATA = (process.env.MOCK_DATA || 'false').toLowerCase() === 'true';
export const MOCK_INTERVAL_MS = 2000;
