// Cliente HTTP de Ubidots Industrial (REST). El dashboard en si usa MQTT en
// vivo; este cliente es para que el agente IA consulte el HISTORICO real
// (tools get_history_ubidots / plot_history) y, mas adelante, los reportes.
//
// Portado de service.py::UbidotsHTTP (Tenebrios). Usa fetch global (Node 18+)
// con header X-Auth-Token. Pagina de verdad siguiendo el campo `next`.

import { UBIDOTS_TOKEN, UBIDOTS_HTTP_BASE } from './config.js';
import { getLogger } from './logger.js';

const log = getLogger('ubidots.http');

export class UbidotsHTTP {
  constructor(token = UBIDOTS_TOKEN, base = UBIDOTS_HTTP_BASE) {
    this.token = token;
    this.base = base.replace(/\/+$/, '');
  }

  async _get(pathOrUrl) {
    const url = /^https?:\/\//.test(pathOrUrl) ? pathOrUrl : `${this.base}${pathOrUrl}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const resp = await fetch(url, {
        headers: { 'X-Auth-Token': this.token },
        signal: ctrl.signal,
      });
      if (!resp.ok) {
        const body = (await resp.text().catch(() => '')).slice(0, 300);
        throw new Error(`Ubidots HTTP ${resp.status}: ${body}`);
      }
      return await resp.json();
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Devuelve las muestras [{timestamp, value}, ...] de una variable en el rango
   * [startMs, endMs], paginando hasta cubrir el rango o llegar a maxPoints.
   * Ascendente por timestamp.
   */
  async getValuesRangeByLabel(deviceLabel, varLabel, startMs, endMs, maxPoints = 20000) {
    const results = [];
    let nextUrl = `/api/v1.6/devices/${deviceLabel}/${varLabel}/values/`
      + `?start=${startMs}&end=${endMs}&page_size=1000`;
    let pages = 0;
    const maxPages = 60; // techo defensivo: 60 * 1000 = 60k puntos
    try {
      while (nextUrl && results.length < maxPoints && pages < maxPages) {
        const data = await this._get(nextUrl);
        pages += 1;
        for (const r of data.results || []) results.push(r);
        nextUrl = data.next || null;
      }
    } catch (e) {
      log.error(`Error range device=${deviceLabel} var=${varLabel} (pag ${pages}): ${e.message}`);
      // Devolvemos lo que alcanzamos a juntar en lugar de perder todo
    }
    results.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    return results.length > maxPoints ? results.slice(0, maxPoints) : results;
  }
}
