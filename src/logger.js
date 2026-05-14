// Logger basado en winston con rotacion diaria. Estructura:
//   logs/
//     2026-05/
//       2026-05-14.log
// Adaptado directamente del patron de tenebrios-node/src/logger.js.

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

import { LOG_LEVEL } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '..');
const LOGS_DIR = path.join(PROJECT_ROOT, 'logs');

function ensureMonthFolder(date) {
  const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  const folder = path.join(LOGS_DIR, yearMonth);
  fs.mkdirSync(folder, { recursive: true });
  return folder;
}

ensureMonthFolder(new Date());

const formatLine = winston.format.printf(({ timestamp, level, message, name }) => {
  const tag = name ? name : 'app';
  return `${timestamp} [${level.toUpperCase()}] ${tag}: ${message}`;
});

const dailyTransport = new DailyRotateFile({
  filename: '%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  dirname: ensureMonthFolder(new Date()),
  utc: false,
  zippedArchive: false,
  maxFiles: null,
});

// En rollover de medianoche, recolocar el archivo dentro de la carpeta YYYY-MM correspondiente.
dailyTransport.on('new', (newFilename) => {
  try {
    const today = new Date();
    const folder = ensureMonthFolder(today);
    const fileName = path.basename(newFilename);
    const targetPath = path.join(folder, fileName);
    if (path.resolve(newFilename) !== path.resolve(targetPath)) {
      dailyTransport.dirname = folder;
    }
  } catch (e) {
    // Silencioso
  }
});

const baseLogger = winston.createLogger({
  level: LOG_LEVEL,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss,SSS' }),
    formatLine,
  ),
  transports: [
    new winston.transports.Console(),
    dailyTransport,
  ],
});

export function getLogger(name) {
  return baseLogger.child({ name });
}

export default baseLogger;
