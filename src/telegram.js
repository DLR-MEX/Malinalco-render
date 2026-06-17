// Notificador Telegram: manda alertas a un chat cuando un sensor cambia de
// estado, y entrega los PDF de reportes (Fase 4).
//
// Portado de ai-predictor/app/service.py::TelegramNotifier. Usa fetch global
// (Node 18+) contra https://api.telegram.org/bot{token}/...
//
// Diseño (igual que el original):
//   - El bot_token SOLO viene de .env, nunca por API.
//   - Cooldown por (var, kind) para no spamear cuando un valor oscila en la
//     frontera del umbral.
//   - Si esta deshabilitado o sin token/chat_id, todos los metodos son no-op.
//   - Sin formato "alerta predictiva": Malinalco no tiene modelo (Fase 5).

import { getLogger } from './logger.js';
import {
  TELEGRAM_ENABLED, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_COOLDOWN_SEC,
} from './config.js';
import { GROUP_UNITS, GROUP_LABELS, rangeFor } from './thresholds.js';

const log = getLogger('telegram');
const TELEGRAM_API = 'https://api.telegram.org';

// Formatea un numero con unidad (2 decimales) o '?' si no es numero.
function fmtVal(value, unit) {
  return typeof value === 'number' && !Number.isNaN(value)
    ? `${value.toFixed(2)}${unit}`
    : '?';
}
// {n:g} de Python: entero sin decimales si es entero, si no compacto.
function g(n) {
  return Number.isInteger(n) ? String(n) : String(n);
}

export class TelegramNotifier {
  constructor({
    botToken = TELEGRAM_BOT_TOKEN,
    chatId = TELEGRAM_CHAT_ID,
    enabled = TELEGRAM_ENABLED,
    cooldownSec = TELEGRAM_COOLDOWN_SEC,
  } = {}) {
    this.botToken = botToken || '';
    this.chatId = chatId || '';
    this.cooldownSec = cooldownSec;
    this.enabled = Boolean(enabled && this.botToken && this.chatId);
    this._lastSent = new Map(); // `${var}|${kind}` -> ts(ms)
    if (this.enabled) {
      log.info(`Telegram notifier ACTIVO (cooldown=${cooldownSec}s)`);
    } else {
      log.info('Telegram notifier deshabilitado (TELEGRAM_ENABLED=false o credenciales vacias)');
    }
  }

  // ¿token + chat_id presentes? (puede mandar aunque enabled=false: lo usa /test)
  get configured() {
    return Boolean(this.botToken && this.chatId);
  }

  _cooldownOk(varName, kind, nowMs) {
    const last = this._lastSent.get(`${varName}|${kind}`);
    return last === undefined || (nowMs - last) >= this.cooldownSec * 1000;
  }

  // --- Alertas por transicion (lo llama el alertMonitor) ---
  // Manda PELIGRO cuando un sensor entra en abnormal y RECUPERACION cuando vuelve
  // a ok. Respeta cooldown por (var, 'current'). No-op si esta deshabilitado.
  notifyTransition({ group, var: varName, value, prevState, newState, ts = Date.now() }) {
    if (!this.enabled) return;
    const unit = GROUP_UNITS[group] || '';
    const label = GROUP_LABELS[group] || group;
    const { low, high } = rangeFor(group);

    if (newState === 'abnormal' && prevState !== 'abnormal') {
      if (this._cooldownOk(varName, 'current', ts)) {
        this._sendAsync(this._fmtDanger(label, varName, value, low, high, unit));
        this._lastSent.set(`${varName}|current`, ts);
      }
    } else if (newState === 'ok' && prevState === 'abnormal') {
      if (this._cooldownOk(varName, 'current', ts)) {
        this._sendAsync(this._fmtRecovered(label, varName, value, unit));
        this._lastSent.set(`${varName}|current`, ts);
      }
    }
  }

  _fmtDanger(label, varName, value, low, high, unit) {
    return `\u{1F6A8} *PELIGRO* — ${label} anormal\n`
      + `Sensor *${varName}* fuera de rango: \`${fmtVal(value, unit)}\`\n`
      + `Rango optimo: ${g(low)}–${g(high)} ${unit}`;
  }

  _fmtRecovered(label, varName, value, unit) {
    return `✅ ${label} normalizado\n`
      + `Sensor *${varName}* regreso al rango: \`${fmtVal(value, unit)}\``;
  }

  // --- Envio de mensajes ---

  // Dispara el envio sin bloquear el callback del store; si Telegram esta caido
  // solo se pierde el mensaje (se loguea el error).
  _sendAsync(text) {
    this.sendMessage(text).catch((e) => log.warn(`Telegram envio fallo: ${e.message}`));
  }

  async sendMessage(text, { parseMode = 'Markdown' } = {}) {
    if (!this.configured) return false;
    const url = `${TELEGRAM_API}/bot${this.botToken}/sendMessage`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          text,
          parse_mode: parseMode,
          disable_web_page_preview: true,
        }),
        signal: ctrl.signal,
      });
      if (!resp.ok) {
        const body = (await resp.text().catch(() => '')).slice(0, 200);
        log.warn(`Telegram sendMessage HTTP ${resp.status}: ${body}`);
        return false;
      }
      return true;
    } finally {
      clearTimeout(timer);
    }
  }

  // Envia un PDF via sendDocument (multipart). Lo usa el ReportScheduler.
  // Devuelve true/false. caption se trunca a 1020 chars como en el original.
  async sendDocument(buffer, filename, caption = '') {
    if (!this.configured) {
      log.warn('sendDocument sin token/chat_id configurado');
      return false;
    }
    const cap = caption.length > 1020 ? `${caption.slice(0, 1020)}...` : caption;
    const safeName = String(filename).replace(/"/g, '_');
    const form = new FormData();
    form.append('chat_id', this.chatId);
    form.append('caption', cap);
    form.append('parse_mode', 'Markdown');
    form.append('document', new Blob([buffer], { type: 'application/pdf' }), safeName);

    const url = `${TELEGRAM_API}/bot${this.botToken}/sendDocument`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60000);
    try {
      const resp = await fetch(url, { method: 'POST', body: form, signal: ctrl.signal });
      if (!resp.ok) {
        const body = (await resp.text().catch(() => '')).slice(0, 200);
        log.warn(`sendDocument HTTP ${resp.status}: ${body}`);
        return false;
      }
      log.info(`sendDocument OK: ${filename} (${(buffer.length / 1024).toFixed(1)}KB)`);
      return true;
    } catch (e) {
      log.warn(`sendDocument fallo: ${e.message}`);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  // Mensaje de prueba sincrono para la UI. Devuelve { sent, message }.
  async test() {
    if (!this.botToken) return { sent: false, message: 'TELEGRAM_BOT_TOKEN no configurado en .env' };
    if (!this.chatId) return { sent: false, message: 'chat_id no configurado' };
    try {
      const ok = await this.sendMessage(
        '✨ *Test* — Asistente IA de Malinalco funcionando.\n'
        + 'Este mensaje confirma que el bot puede escribir en este chat.',
      );
      return ok
        ? { sent: true, message: 'Mensaje enviado' }
        : { sent: false, message: 'Telegram rechazo el mensaje (revisa token/chat_id)' };
    } catch (e) {
      return { sent: false, message: `Error: ${e.message}` };
    }
  }

  // Hot-reload de config en runtime (sin token: solo .env). El alertMonitor y los
  // endpoints comparten esta misma instancia.
  updateSettings({ chatId, enabled, cooldownSec } = {}) {
    if (chatId !== undefined) this.chatId = String(chatId).trim();
    if (cooldownSec !== undefined) this.cooldownSec = Number(cooldownSec);
    if (enabled !== undefined) {
      this.enabled = Boolean(enabled && this.botToken && this.chatId);
    } else {
      this.enabled = Boolean(this.enabled && this.botToken && this.chatId);
    }
    log.info(`Telegram config actualizada: enabled=${this.enabled} chat_id=${this.chatId ? '***' : '(vacio)'} cooldown=${this.cooldownSec}s`);
    return this.snapshot();
  }

  // Estado publicable. Nunca expone el bot_token (solo si esta configurado).
  snapshot() {
    return {
      enabled: this.enabled,
      chat_id: this.chatId || '',
      cooldown_sec: this.cooldownSec,
      token_configured: Boolean(this.botToken),
    };
  }
}
