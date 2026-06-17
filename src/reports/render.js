// Render de reportes: HTML -> PDF con puppeteer (Chromium headless). Las graficas
// se dibujan con ECharts dentro de la misma pagina headless (coherente con el
// render inline del chat) y luego se imprime a PDF.
//
// Portado/simplificado de ai-predictor/app/reports/render.py (que usaba
// Playwright + Jinja2 + matplotlib). Aqui: puppeteer + template HTML embebido +
// ECharts por CDN. Sin commentary LLM (se omite para no encarecer el reporte).

import fs from 'node:fs';
import path from 'node:path';
import { getLogger } from '../logger.js';
import {
  REPORTS_DIR, PUPPETEER_EXECUTABLE_PATH,
} from '../config.js';
import { GROUP_LABELS, GROUP_UNITS } from '../thresholds.js';

const log = getLogger('reports.render');

const STATE_LABEL = { ok: 'OK', abnormal: 'ANORMAL', unknown: 's/d' };
const PLOT_COLORS = ['#E8B830', '#4FC3F7', '#81C784', '#FF8A65', '#BA68C8', '#A1887F', '#F06292', '#4DB6AC'];

let _browser = null;

// Lanza (lazy) una unica instancia de Chromium reutilizable. En la Pi conviene
// apuntar PUPPETEER_EXECUTABLE_PATH al Chromium del sistema.
async function getBrowser() {
  if (_browser && _browser.connected) return _browser;
  const { default: puppeteer } = await import('puppeteer');
  const opts = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  };
  if (PUPPETEER_EXECUTABLE_PATH) opts.executablePath = PUPPETEER_EXECUTABLE_PATH;
  _browser = await puppeteer.launch(opts);
  log.info('Chromium (puppeteer) iniciado');
  return _browser;
}

export async function closeBrowser() {
  if (_browser) {
    try { await _browser.close(); } catch { /* noop */ }
    _browser = null;
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Construye el HTML completo del reporte. Inyecta `data`/`current` como JSON y
// deja que ECharts dibuje en la pagina headless; marca window.__chartsReady al terminar.
function buildHtml(data, current, title) {
  const payload = JSON.stringify({ data, current }).replace(/</g, '\\u003c');
  const reportTitle = title || 'Reporte ejecutivo — Acopinalco';
  const a = data.alerts;

  const currentTableRows = current.map((r) => `
    <tr>
      <td>${esc(r.sensor)}</td><td>${esc(r.zone)}</td>
      <td class="st-${r.temp_state}">${r.temp ?? '—'} ${r.temp != null ? '°C' : ''}</td>
      <td class="st-${r.hum_state}">${r.hum ?? '—'} ${r.hum != null ? '%' : ''}</td>
    </tr>`).join('');

  const statsRows = (group) => Object.entries(data.history[group] || {}).map(([v, s]) => `
    <tr>
      <td>${esc(s.sensor || v)}</td>
      <td>${s.min ?? '—'}</td><td>${s.max ?? '—'}</td><td>${s.avg ?? '—'}</td>
      <td>${s.time_outside_pct ?? '—'}%</td><td>${s.n ?? 0}</td>
    </tr>`).join('');

  const alertRows = a.transitions.length
    ? a.transitions.map((t) => `<tr><td>${esc(t.ts_iso)}</td><td>${esc(t.var)}</td><td>${esc(t.group)}</td><td>${esc(t.transition)}</td><td>${t.value ?? '—'}</td></tr>`).join('')
    : '<tr><td colspan="5" class="muted">Sin transiciones en el periodo.</td></tr>';

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #1a2630; margin: 0; padding: 28px 32px; }
  h1 { font-size: 22px; margin: 0 0 4px; color: #1a2630; }
  h2 { font-size: 15px; margin: 22px 0 8px; color: #8a6d10; border-bottom: 2px solid #E8B830; padding-bottom: 3px; }
  .sub { color: #5b6b76; font-size: 12px; margin-bottom: 14px; }
  .cards { display: flex; gap: 12px; margin: 10px 0 4px; }
  .card { flex: 1; background: #f6f8fa; border: 1px solid #e1e7ec; border-radius: 8px; padding: 12px 14px; }
  .card .n { font-size: 26px; font-weight: 700; color: #1a2630; }
  .card .l { font-size: 11px; color: #5b6b76; text-transform: uppercase; letter-spacing: .04em; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin: 6px 0; }
  th { background: #1a2630; color: #E8B830; text-align: left; padding: 6px 9px; font-size: 10px; text-transform: uppercase; letter-spacing: .03em; }
  td { padding: 5px 9px; border-bottom: 1px solid #eef2f5; }
  tr:nth-child(even) td { background: #fafbfc; }
  .muted { color: #99a; text-align: center; }
  .st-abnormal { color: #c0392b; font-weight: 700; }
  .st-ok { color: #27923c; }
  .st-unknown { color: #99a; }
  .chart { width: 100%; height: 280px; margin: 6px 0 14px; }
  footer { margin-top: 24px; font-size: 10px; color: #99a; border-top: 1px solid #eef2f5; padding-top: 8px; }
</style></head>
<body>
  <h1>${esc(reportTitle)}</h1>
  <div class="sub">Periodo: ${esc(data.meta.start_iso)} a ${esc(data.meta.end_iso)} · ${data.meta.hours} h · Device ${esc(data.meta.device)} · Generado ${esc(data.meta.generated_iso)}</div>

  <div class="cards">
    <div class="card"><div class="n">${a.transitions_to_abnormal}</div><div class="l">Alertas críticas</div></div>
    <div class="card"><div class="n">${a.transitions_total}</div><div class="l">Transiciones</div></div>
    <div class="card"><div class="n">${a.jumps_total}</div><div class="l">Saltos bruscos</div></div>
  </div>

  <h2>Estado actual</h2>
  <table><thead><tr><th>Sensor</th><th>Zona</th><th>Temp</th><th>Hum</th></tr></thead><tbody>${currentTableRows}</tbody></table>

  <h2>Temperatura — tendencia del periodo</h2>
  <div id="chart-TEMP" class="chart"></div>
  <table><thead><tr><th>Sensor</th><th>Mín</th><th>Máx</th><th>Prom</th><th>% fuera</th><th>n</th></tr></thead><tbody>${statsRows('TEMP')}</tbody></table>

  <h2>Humedad — tendencia del periodo</h2>
  <div id="chart-HUM" class="chart"></div>
  <table><thead><tr><th>Sensor</th><th>Mín</th><th>Máx</th><th>Prom</th><th>% fuera</th><th>n</th></tr></thead><tbody>${statsRows('HUM')}</tbody></table>

  <h2>Alertas del periodo</h2>
  <table><thead><tr><th>Fecha</th><th>Sensor</th><th>Grupo</th><th>Transición</th><th>Valor</th></tr></thead><tbody>${alertRows}</tbody></table>

  <footer>Acopinalco — Monitor ambiental · reporte generado automaticamente por el Asistente IA.</footer>

  <script>
    const PAYLOAD = ${payload};
    const COLORS = ${JSON.stringify(PLOT_COLORS)};
    const UNITS = ${JSON.stringify(GROUP_UNITS)};
    function drawGroup(group) {
      const el = document.getElementById('chart-' + group);
      if (!el || !window.echarts) return;
      const ts = (PAYLOAD.data.time_series[group] || []).filter(s => s.data && s.data.length);
      const th = PAYLOAD.data.thresholds[group];
      const chart = echarts.init(el, null, { renderer: 'canvas' });
      const series = ts.map((s, i) => ({
        name: s.sensor || s.var, type: 'line', showSymbol: false, smooth: true,
        lineStyle: { width: 1.5, color: COLORS[i % COLORS.length] },
        itemStyle: { color: COLORS[i % COLORS.length] },
        data: s.data,
        markLine: i === 0 && th ? { symbol: 'none', lineStyle: { color: '#c0392b', type: 'dashed', width: 1 },
          data: [{ yAxis: th.min }, { yAxis: th.max }] } : undefined,
      }));
      chart.setOption({
        animation: false,
        grid: { left: 48, right: 16, top: 30, bottom: 24 },
        legend: { top: 0, type: 'scroll', textStyle: { fontSize: 10 } },
        tooltip: { trigger: 'axis' },
        xAxis: { type: 'time' },
        yAxis: { type: 'value', scale: true, axisLabel: { formatter: '{value}' + (UNITS[group] || '') } },
        series,
      });
    }
    try { drawGroup('TEMP'); drawGroup('HUM'); } catch (e) { console.error(e); }
    // Da un respiro al canvas para pintar antes de imprimir.
    setTimeout(() => { window.__chartsReady = true; }, 350);
  </script>
</body></html>`;
}

// Renderiza el reporte a PDF + un PNG de preview (primera "pagina"). Reusa una
// sola pagina puppeteer para ambos.
export async function renderReport(data, current, title) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 820, height: 1160, deviceScaleFactor: 1 });
    await page.setContent(buildHtml(data, current, title), { waitUntil: 'networkidle0', timeout: 45000 });
    await page.waitForFunction('window.__chartsReady === true', { timeout: 8000 }).catch(() => {
      log.warn('charts no marcaron ready; imprimo de todas formas');
    });
    const pdf = await page.pdf({
      format: 'A4', printBackground: true,
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
    });
    let preview = null;
    try {
      preview = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 820, height: 1160 } });
    } catch (e) {
      log.warn(`preview png fallo: ${e.message}`);
    }
    return { pdf: Buffer.from(pdf), preview: preview ? Buffer.from(preview) : null };
  } finally {
    await page.close().catch(() => {});
  }
}

// --- Persistencia en disco de los PDFs + helpers para los endpoints ---

function reportsDir() {
  const dir = path.resolve(REPORTS_DIR);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function dateTag(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function timeTag(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
}

// Guarda PDF (+ preview + metadata) y devuelve el report_card.
export function saveReport({ pdf, preview }, startMs, endMs, meta, summary) {
  const dir = reportsDir();
  const startD = dateTag(startMs);
  const endD = dateTag(endMs);
  // El report_id debe ser unico: si el end no es medianoche, añadimos HHMM.
  const endIsMidnight = new Date(endMs).getHours() === 0 && new Date(endMs).getMinutes() === 0;
  const reportId = `reporte-malinalco_${startD}_a_${endD}${endIsMidnight ? '' : `_${timeTag(endMs)}`}`;
  const filename = `${reportId}.pdf`;
  fs.writeFileSync(path.join(dir, filename), pdf);
  const hasPreview = Boolean(preview);
  if (hasPreview) fs.writeFileSync(path.join(dir, `${reportId}.preview.png`), preview);
  const card = {
    report_id: reportId,
    filename,
    size_kb: Math.round((pdf.length / 1024) * 10) / 10,
    url: `/api/reports/${reportId}`,
    preview_url: hasPreview ? `/api/reports/${reportId}/preview` : null,
    period_iso: `${meta.start_iso} a ${meta.end_iso}`,
    hours: meta.hours,
    summary,
    generated_iso: meta.generated_iso,
  };
  fs.writeFileSync(path.join(dir, `${reportId}.json`), JSON.stringify(card, null, 2));
  return card;
}

// Lista los reportes guardados (por mtime DESC, max 50) leyendo los sidecars JSON.
export function listReports() {
  const dir = reportsDir();
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'schedules.json');
  } catch { return []; }
  return files
    .map((f) => {
      try {
        const stat = fs.statSync(path.join(dir, f));
        return { card: JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')), mtime: stat.mtimeMs };
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 50)
    .map((x) => x.card);
}

// Resuelve la ruta de un PDF/preview por report_id, validando que no escape del dir.
export function reportFilePath(reportId, kind = 'pdf') {
  const safe = String(reportId).replace(/[^a-zA-Z0-9_.-]/g, '');
  if (!safe) return null;
  const dir = reportsDir();
  const file = kind === 'preview' ? `${safe}.preview.png` : `${safe}.pdf`;
  const full = path.join(dir, file);
  if (!full.startsWith(dir)) return null;
  return fs.existsSync(full) ? full : null;
}
