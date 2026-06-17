// Servicio de reportes: orquesta collector (datos) + render (PDF) + persistencia.
// Lo usan las tools del agente, los endpoints REST y el scheduler.

import { getLogger } from '../logger.js';
import { collectPeriodData, currentRows } from './collector.js';
import {
  renderReport, saveReport, listReports, reportFilePath, closeBrowser,
} from './render.js';

const log = getLogger('reports.service');

const MAX_RANGE_MS = 31 * 86400 * 1000; // 31 dias

export class ReportsService {
  constructor({ store, ubidots = null, alertLog = null, telegram = null }) {
    this.store = store;
    this.ubidots = ubidots;
    this.alertLog = alertLog;
    this.telegram = telegram;
  }

  /**
   * Genera un PDF ejecutivo del periodo. Devuelve el report_card (la forma que
   * agent.js cosecha en `reports[]` y chat.js renderiza como tarjeta).
   * @param {object} o { startMs, endMs, title?, sendToTelegram? }
   */
  async generate({ startMs, endMs, title = null, sendToTelegram = false }) {
    if (!(endMs > startMs)) throw new Error('end debe ser mayor a start');
    if (endMs - startMs > MAX_RANGE_MS) throw new Error('rango maximo 31 dias');

    log.info(`Generando reporte (${((endMs - startMs) / 3600000).toFixed(1)}h) — puede tardar varios segundos`);
    const data = await collectPeriodData(
      { store: this.store, ubidots: this.ubidots, alertLog: this.alertLog },
      startMs, endMs,
    );
    const current = currentRows(this.store);
    const buffers = await renderReport(data, current, title);
    const summary = {
      transitions_to_abnormal: data.alerts.transitions_to_abnormal,
      jumps_total: data.alerts.jumps_total,
    };
    const card = saveReport(buffers, data.meta.start_ts, data.meta.end_ts, data.meta, summary);

    card.sent_to_telegram = false;
    if (sendToTelegram && this.telegram && this.telegram.configured) {
      const caption = `📊 *${title || 'Reporte ejecutivo'}*\n`
        + `Periodo: ${data.meta.start_iso} a ${data.meta.end_iso}\n`
        + `Alertas críticas: ${summary.transitions_to_abnormal} · Saltos: ${summary.jumps_total}`;
      try {
        card.sent_to_telegram = await this.telegram.sendDocument(buffers.pdf, card.filename, caption);
      } catch (e) {
        log.warn(`send_to_telegram fallo: ${e.message}`);
      }
    }
    log.info(`Reporte ${card.filename} (${card.size_kb}KB) generado`);
    return card;
  }

  list() {
    return listReports();
  }

  filePath(reportId, kind = 'pdf') {
    return reportFilePath(reportId, kind);
  }

  async close() {
    await closeBrowser();
  }
}
