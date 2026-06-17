// Agente conversacional de Malinalco. Envuelve un LLM (Ollama Cloud — API REST)
// y le da tools puras (solo lectura) para responder preguntas en lenguaje
// natural sobre el complejo de invernaderos.
//
// Portado de ai-predictor/app/agent.py (Tenebrios):
//   - Sin acciones (no modifica nada — pura consulta).
//   - Si no hay OLLAMA_API_KEY, `ready` queda en false y el endpoint responde 503.
//   - Cliente HTTP directo via fetch global (Node 18+), POST a {host}/api/chat
//     con Authorization Bearer.
//   - Loop manual de tools (no frameworks) para mantenerlo legible y debuggable.

import { getLogger } from '../logger.js';
import { buildSystemPrompt } from './prompt.js';

const log = getLogger('agent');

const MAX_TOOL_LOOPS = 10;      // techo defensivo contra loops infinitos
const REQUEST_TIMEOUT_MS = 60000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class AgentService {
  /**
   * @param {object} opts
   * @param {string} opts.apiKey   OLLAMA_API_KEY (vacio => agente inactivo)
   * @param {string} opts.host     base URL de Ollama Cloud
   * @param {string} opts.model    modelo (ej. gpt-oss:120b)
   * @param {boolean} opts.enabled AGENT_ENABLED
   * @param {object} opts.tools    registro { schemas, execute(name, args) }
   */
  constructor({ apiKey, host, model, enabled, tools }) {
    this.apiKey = apiKey || '';
    this.host = (host || 'https://ollama.com').replace(/\/+$/, '');
    this.model = model || 'gpt-oss:120b';
    this.tools = tools;
    this.enabled = Boolean(enabled && this.apiKey);
    this.systemPrompt = buildSystemPrompt();

    if (this.enabled) {
      log.info(`Agente IA ACTIVO (host=${this.host}, model=${this.model})`);
    } else {
      log.info('Agente IA deshabilitado (AGENT_ENABLED=false o sin OLLAMA_API_KEY)');
    }
  }

  get ready() {
    return this.enabled;
  }

  // POST a /api/chat con reintentos en 5xx (Ollama transitorio). Devuelve el
  // JSON parseado, o null si tras 3 intentos sigue fallando.
  async _postWithRetries(messages, toolSchemas, loopIdx) {
    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
      try {
        const resp = await fetch(`${this.host}/api/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.model,
            messages,
            tools: toolSchemas,
            stream: false,
          }),
          signal: ctrl.signal,
        });
        if (resp.ok) return await resp.json();

        const status = resp.status;
        const body = (await resp.text().catch(() => '')).slice(0, 500);
        if (status >= 500 && attempt < maxAttempts - 1) {
          const delay = 1500 * 2 ** attempt; // 1.5s, 3s
          log.warn(`Ollama HTTP ${status} loop=${loopIdx} intento=${attempt + 1}, retry en ${delay}ms`);
          await sleep(delay);
          continue;
        }
        if (status >= 500) {
          log.error(`Ollama HTTP ${status} loop=${loopIdx} (final): ${body}`);
          return null;
        }
        // 4xx: error terminal (auth, formato) — propagamos
        throw new Error(`Ollama Cloud devolvio HTTP ${status}: ${body}`);
      } catch (e) {
        // Timeout o error de red: reintentamos
        if (e.name === 'AbortError' || e.name === 'TypeError') {
          if (attempt < maxAttempts - 1) {
            const delay = 1500 * 2 ** attempt;
            log.warn(`Error red Ollama loop=${loopIdx} intento=${attempt + 1}: ${e.message}, retry en ${delay}ms`);
            await sleep(delay);
            continue;
          }
          log.error(`Error red Ollama loop=${loopIdx} (final): ${e.message}`);
          return null;
        }
        throw e;
      } finally {
        clearTimeout(timer);
      }
    }
    return null;
  }

  /**
   * messages: [{ role: 'user'|'assistant'|'system', content }]. El system
   * prompt se inyecta al inicio si el caller no lo puso.
   * Devuelve { reply, tool_calls, charts, reports, model }.
   */
  async chat(messages, { disableTools = false } = {}) {
    if (!this.ready) {
      throw new Error('Agente no esta activo (revisa OLLAMA_API_KEY en .env)');
    }

    let convo = messages.slice();
    if (!convo.length || convo[0].role !== 'system') {
      convo = [{ role: 'system', content: this.systemPrompt }, ...convo];
    }

    const toolCallsSummary = [];
    const charts = [];   // emitidos por plot_history -> se renderizan inline
    const reports = [];  // emitidos por generate_report -> tarjetas en el widget
    const toolSchemas = disableTools ? [] : this.tools.schemas;

    for (let loopIdx = 0; loopIdx < MAX_TOOL_LOOPS; loopIdx++) {
      const response = await this._postWithRetries(convo, toolSchemas, loopIdx);
      if (response === null) {
        // Ollama sigue 5xx tras reintentos: respuesta amigable, no explotamos.
        let partial = '';
        for (let i = convo.length - 1; i >= 0; i--) {
          if (convo[i].role === 'assistant' && convo[i].content) { partial = convo[i].content; break; }
        }
        return {
          reply: partial
            ? `${partial}\n\n_(Ollama Cloud tuvo un error temporal; esta es una respuesta parcial. Intenta de nuevo en unos segundos.)_`
            : 'Ollama Cloud esta respondiendo con errores en este momento (problema del proveedor). Intenta de nuevo en unos segundos.',
          tool_calls: toolCallsSummary,
          charts, reports,
          model: this.model,
          error: 'ollama_5xx',
        };
      }

      const msg = response.message || {};
      convo.push({
        role: 'assistant',
        content: msg.content || '',
        tool_calls: msg.tool_calls || [],
      });

      const calls = msg.tool_calls || [];
      if (!calls.length) {
        return {
          reply: msg.content || '',
          tool_calls: toolCallsSummary,
          charts, reports,
          model: this.model,
        };
      }

      for (const call of calls) {
        const fn = call.function || {};
        const name = fn.name || '';
        let args = fn.arguments || {};
        if (typeof args === 'string') {
          try { args = JSON.parse(args); } catch { args = {}; }
        }
        log.info(`Tool call: ${name}(${JSON.stringify(args)})`);
        toolCallsSummary.push({ name, args });

        let result;
        try {
          result = await this.tools.execute(name, args);
        } catch (e) {
          log.warn(`Tool ${name} fallo: ${e.message}`);
          result = { error: e.message };
        }

        // Charts y reports: al LLM solo le mandamos un resumen; los specs/
        // tarjetas van al cliente para render inline.
        let payloadForLlm = result;
        if (result && typeof result === 'object' && result.chart_spec) {
          charts.push(result.chart_spec);
          payloadForLlm = { chart_rendered: true, summary: result.summary, _note: result._note };
        } else if (result && typeof result === 'object' && result.report_card) {
          reports.push(result.report_card);
          payloadForLlm = {
            report_generated: true,
            period: result.report_card.period_iso,
            summary: result.report_card.summary,
            size_kb: result.report_card.size_kb,
            _note: result._note,
          };
        }

        convo.push({
          role: 'tool',
          name,
          content: JSON.stringify(payloadForLlm ?? {}).slice(0, 8000),
        });
      }
    }

    log.warn(`Agente alcanzo MAX_TOOL_LOOPS=${MAX_TOOL_LOOPS} sin respuesta final`);
    return {
      reply: 'Disculpa, no pude completar la consulta (demasiados pasos). Intenta reformular la pregunta.',
      tool_calls: toolCallsSummary,
      charts, reports,
      model: this.model,
    };
  }
}
