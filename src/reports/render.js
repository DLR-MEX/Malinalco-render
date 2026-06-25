// Render del reporte EJECUTIVO: HTML -> PDF con puppeteer (Chromium headless).
//
// Portado del reporte ejecutivo de ai-predictor (Playwright + Jinja2 + matplotlib)
// a la pila de Malinalco (puppeteer + template embebido + ECharts). Estructura:
// portada + secciones paginadas, graficas limpias (1 serie = promedio interior) y
// narrativa IA opcional. El layout usa @page (preferCSSPageSize) + page-break para
// que NADA se desborde ni se corte (el bug del render plano anterior).

import fs from 'node:fs';
import path from 'node:path';
import { getLogger } from '../logger.js';
import {
  REPORTS_DIR, PUPPETEER_EXECUTABLE_PATH,
} from '../config.js';
import { clientChartsScript } from './charts.js';

const log = getLogger('reports.render');

let _browser = null;

// Lanza (lazy) una unica instancia de Chromium reutilizable. En la Pi/VPS conviene
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
function fmtNum(v, unit = '') {
  return (v === null || v === undefined || Number.isNaN(v)) ? '—' : `${v}${unit}`;
}

// % del tiempo en rango por grupo: 100 - promedio ponderado de time_outside_pct.
function pctInRange(historyGroup) {
  let totalN = 0;
  let outsideWeighted = 0;
  for (const s of Object.values(historyGroup || {})) {
    const n = s.n || 0;
    const out = s.time_outside_pct || 0;
    totalN += n;
    outsideWeighted += (out / 100) * n;
  }
  if (!totalN) return 0;
  return Math.round(100 - (outsideWeighted / totalN) * 100);
}

// ---------- CSS (tema dorado/oscuro, A4, sin desbordamiento) ----------
const CSS = `
@page { size: A4; margin: 14mm 13mm; }
@page :first { margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; color: #1a2630;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; font-size: 10pt; line-height: 1.5; background: #fff; }
code { background: rgba(232,184,48,0.16); padding: 1px 5px; border-radius: 3px;
  font-family: 'Consolas', monospace; font-size: 0.9em; }
.muted { color: #607888; }
.small { font-size: 8pt; }

/* ---- portada ---- */
.cover { width: 100%; height: 297mm; margin: 0;
  background: linear-gradient(135deg, #1a2630 0%, #243B4A 60%, #344955 100%);
  color: #e8e0d8; display: flex; align-items: center; justify-content: center;
  page-break-after: always; }
.cover-inner { width: 74%; text-align: center; }
.brand-title { font-size: 22pt; font-weight: 800; letter-spacing: 5px; color: #E8B830; }
.brand-title span { color: #fff; opacity: 0.7; }
.brand-sub { font-size: 8pt; color: #8aa0b0; letter-spacing: 3px; text-transform: uppercase; margin: 4px 0 70px; }
.cover-title { font-size: 34pt; font-weight: 900; color: #fff; letter-spacing: 7px; margin-bottom: 6px; }
.cover-period { font-size: 13pt; color: #E8B830; margin-bottom: 8px; letter-spacing: 1px; }
.cover-meta { color: #8aa0b0; font-size: 9pt; margin-bottom: 46px; }
.cover-meta code { background: rgba(232,184,48,0.20); color: #E8B830; }
.cover-summary { display: flex; justify-content: space-around; gap: 16px; margin: 36px 0; }
.summary-item { flex: 1; background: rgba(255,255,255,0.04); border: 1px solid rgba(232,184,48,0.30);
  border-radius: 10px; padding: 16px 8px; }
.summary-num { font-size: 27pt; font-weight: 900; color: #E8B830; line-height: 1; }
.summary-label { font-size: 8pt; color: #8aa0b0; text-transform: uppercase; letter-spacing: 2px; margin-top: 8px; }
.cover-footer { margin-top: 80px; color: #607888; font-size: 8pt; letter-spacing: 2px; }

/* ---- paginas ---- */
.page { page-break-before: always; }
h1 { font-size: 19pt; color: #1a2630; border-bottom: 3px solid #E8B830;
  padding-bottom: 6px; margin: 0 0 14px; letter-spacing: 1px; }
h2 { font-size: 12.5pt; color: #344955; margin: 18px 0 8px; border-left: 4px solid #E8B830; padding-left: 10px; }
.prose { margin-bottom: 12px; text-align: justify; }
.prose p { margin: 0 0 8px; }
.prose strong { color: #1a2630; }
.prose ul { margin: 4px 0 10px; padding-left: 22px; }
.section-intro { background: rgba(232,184,48,0.08); border-left: 4px solid #E8B830;
  padding: 8px 12px; margin: 4px 0 14px; font-size: 9.5pt; border-radius: 0 4px 4px 0; }
.chart-caption { font-size: 8.5pt; color: #607888; margin: 2px 0 4px; font-style: italic; }

/* ---- KPIs ---- */
.kpi-grid { display: flex; gap: 10px; margin: 10px 0 18px; flex-wrap: wrap; }
.kpi { flex: 1; min-width: 120px; background: linear-gradient(160deg, #243B4A, #1a2630);
  color: #e8e0d8; border-radius: 10px; padding: 12px 10px; text-align: center; border: 1px solid #3a5a6a;
  page-break-inside: avoid; }
.kpi-val { font-size: 18pt; font-weight: 900; color: #E8B830; line-height: 1.1; margin-bottom: 4px; }
.kpi-label { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.5px; color: #8aa0b0; }
.kpi-sub { font-size: 7.5pt; color: #607888; margin-top: 3px; }

/* ---- graficas (sin desbordamiento) ---- */
.chart { width: 100%; height: 320px; margin: 6px 0 16px; page-break-inside: avoid; }
.chart.heatmap { height: 360px; }
.chart-block { page-break-inside: avoid; }
.chart-block h2 { margin-top: 14px; }

/* ---- tablas ---- */
.data-table { width: 100%; border-collapse: collapse; margin: 10px 0 18px; font-size: 9.5pt;
  page-break-inside: avoid; }
.data-table thead th { background: #1a2630; color: #E8B830; text-align: left; padding: 7px 10px;
  font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; font-size: 8pt; border-bottom: 2px solid #E8B830; }
.data-table tbody td { padding: 6px 10px; border-bottom: 1px solid #e5e7eb; }
.data-table tbody tr:nth-child(even) td { background: #fafafa; }
.data-table.compact tbody td { padding: 4px 10px; font-size: 9pt; }
.data-table tbody tr.danger td { background: rgba(239,68,68,0.08); border-left: 3px solid #ef4444; }
.data-table tbody tr.ok td { background: rgba(52,211,153,0.06); }
.st-abnormal { color: #c0392b; font-weight: 700; }
.st-ok { color: #27923c; }
.st-unknown { color: #99a; }

.disclaimer { background: rgba(245,158,11,0.10); border-left: 4px solid #f59e0b; padding: 10px 14px;
  margin-bottom: 14px; border-radius: 4px; font-size: 9pt; color: #78350f; }
.report-end { margin-top: 26px; page-break-inside: avoid; }
.report-end hr { border: none; border-top: 1px solid #cbd5e1; margin: 20px 0 10px; }
.report-end p { text-align: center; margin: 0; }
`;

// Construye el HTML completo del reporte ejecutivo.
function buildHtml(data, current, commentary, title) {
  const c = commentary || {};
  const a = data.alerts;
  const meta = data.meta;
  const th = data.thresholds;
  const agg = data.aggregations || {};
  const okTemp = pctInRange(data.history.TEMP);
  const okHum = pctInRange(data.history.HUM);
  const reportTitle = title || 'Reporte ejecutivo — Acopinalco';

  // Hora mas caliente del dia (perfil horario de temperatura).
  let hotHour = null;
  let hotHourVal = null;
  const hourlyT = (agg.TEMP || {}).hourly_profile || [];
  if (hourlyT.length) {
    const peak = hourlyT.reduce((m, h) => (h.avg > m.avg ? h : m), hourlyT[0]);
    hotHour = peak.hour;
    hotHourVal = peak.avg;
  }

  const to = (agg.TEMP || {}).overall || {};
  const ho = (agg.HUM || {}).overall || {};
  const hasCifras = Object.keys(to).length || Object.keys(ho).length;

  // ---- tabla estado actual por sensor ----
  const currentRowsHtml = current.map((r) => `
    <tr>
      <td>${esc(r.sensor)}</td><td>${esc(r.zone)}</td>
      <td class="st-${r.temp_state}">${fmtNum(r.temp, ' °C')}</td>
      <td class="st-${r.hum_state}">${fmtNum(r.hum, ' %')}</td>
    </tr>`).join('');

  // ---- cronologia de alertas (ultimas ~18, mas recientes primero) ----
  const txs = (a.transitions || []).slice(-18).reverse();
  const alertRows = txs.length
    ? txs.map((t) => {
      const toAbn = /->abnormal$/.test(t.transition);
      const toOk = /->ok$/.test(t.transition);
      const cls = toAbn ? 'danger' : (toOk ? 'ok' : '');
      const desc = toAbn ? 'Entró en alerta' : (toOk ? 'Se normalizó' : esc(t.transition));
      return `<tr class="${cls}"><td>${esc(t.ts_iso)}</td><td><code>${esc(t.var)}</code></td><td>${desc}</td><td>${fmtNum(t.value)}</td></tr>`;
    }).join('')
    : '<tr><td colspan="4" class="muted">Sin cambios de estado en el periodo.</td></tr>';

  // ---- helpers de seccion de graficas ----
  const has = (group, key) => {
    const g = agg[group] || {};
    if (key === 'heatmap') return Boolean(g.heatmap && g.heatmap.values && g.heatmap.values.length);
    if (key === 'weekly') return Boolean(g.weekly && g.weekly.length >= 2);
    if (key === 'hourly') return Boolean((g.hourly_profile || []).length);
    // 'daily' e 'in_range' se alimentan ambos del arreglo diario.
    return Boolean((g.daily || []).length);
  };
  const chartBlock = (group, key, h2, caption) => {
    const p = group.toLowerCase();
    if (!has(group, key)) return '';
    const extra = key === 'heatmap' ? ' heatmap' : '';
    // Agrupado para que el titulo no quede huerfano de su grafica al paginar.
    return `<div class="chart-block"><h2>${h2}</h2><p class="chart-caption">${caption}</p>`
      + `<div id="${p}_${key}" class="chart${extra}"></div></div>`;
  };

  const tempCharts = (agg.TEMP)
    ? chartBlock('TEMP', 'heatmap', '¿A qué horas hace más calor?', 'Cada celda es el promedio de esa hora en ese día. Colores cálidos = más caliente.')
    + chartBlock('TEMP', 'hourly', 'El día típico', 'Promedio de cada hora juntando todos los días. El punto rojo marca la hora más caliente.')
    + chartBlock('TEMP', 'daily', 'Promedio por día frente al rango ideal', 'Barra = promedio del día. La franja verde es el rango ideal.')
    + chartBlock('TEMP', 'in_range', 'Tiempo en condiciones óptimas', 'Qué % del día estuvo dentro del rango ideal. Verde = bien, ámbar = regular, rojo = atención.')
    : '<p class="muted">Sin histórico disponible para graficar temperatura.</p>';

  const humCharts = (agg.HUM)
    ? chartBlock('HUM', 'heatmap', '¿A qué horas cambia la humedad?', 'Cada celda es el promedio de esa hora en ese día.')
    + chartBlock('HUM', 'hourly', 'El día típico', 'Promedio de cada hora juntando todos los días.')
    + chartBlock('HUM', 'daily', 'Promedio por día frente al rango ideal', 'Barra = promedio del día. La franja verde es el rango ideal.')
    + chartBlock('HUM', 'in_range', 'Tiempo en condiciones óptimas', 'Qué % del día la humedad estuvo dentro del rango ideal.')
    : '<p class="muted">Sin histórico disponible para graficar humedad.</p>';

  const showWeekly = has('TEMP', 'weekly') || has('HUM', 'weekly');
  const weeklySection = showWeekly ? `
  <section class="page">
    <h1>Comparativa semanal</h1>
    <p class="section-intro">Comparación del desempeño semana por semana (% del tiempo en rango óptimo).
    La semana en verde fue la mejor; la roja, la que necesitó más atención.</p>
    ${c.weekly ? `<div class="prose">${c.weekly}</div>` : ''}
    ${has('TEMP', 'weekly') ? '<h2>Temperatura por semana</h2><div id="temp_weekly" class="chart"></div>' : ''}
    ${has('HUM', 'weekly') ? '<h2>Humedad por semana</h2><div id="hum_weekly" class="chart"></div>' : ''}
  </section>` : '';

  const payload = JSON.stringify({ data }).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<title>${esc(reportTitle)}</title>
<script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>
<style>${CSS}</style>
</head>
<body>

<section class="cover">
  <div class="cover-inner">
    <div class="brand-title">MALINALCO <span>RENDER</span></div>
    <div class="brand-sub">Acopinalco · monitoreo ambiental</div>
    <div class="cover-title">REPORTE EJECUTIVO</div>
    <div class="cover-period">${esc(meta.start_iso)} — ${esc(meta.end_iso)}</div>
    <div class="cover-meta">
      ${meta.days >= 1 ? `${Math.round(meta.days)} día(s) de monitoreo` : `${meta.hours} horas`}
      · Dispositivo: <code>${esc(meta.device)}</code>
    </div>
    <div class="cover-summary">
      <div class="summary-item"><div class="summary-num">${okTemp}%</div><div class="summary-label">Temperatura en rango</div></div>
      <div class="summary-item"><div class="summary-num">${okHum}%</div><div class="summary-label">Humedad en rango</div></div>
      <div class="summary-item"><div class="summary-num">${a.transitions_to_abnormal}</div><div class="summary-label">Alertas críticas</div></div>
    </div>
    <div class="cover-footer">Generado por Malinalco Render · ${esc(meta.generated_iso)}</div>
  </div>
</section>

<section class="page">
  <h1>Resumen ejecutivo</h1>
  <div class="prose">${c.summary || `<p>Durante el periodo del ${esc(meta.start_iso)} al ${esc(meta.end_iso)} el sistema registró <strong>${a.transitions_to_abnormal} alertas críticas</strong>.</p>`}</div>

  ${hasCifras ? `
  <h2>Cifras del periodo</h2>
  <table class="data-table">
    <thead><tr><th>Métrica</th><th>Temperatura</th><th>Humedad</th></tr></thead>
    <tbody>
      <tr><td>Promedio</td><td>${fmtNum(to.avg, ' °C')}</td><td>${fmtNum(ho.avg, ' %')}</td></tr>
      <tr><td>Mediana</td><td>${fmtNum(to.median, ' °C')}</td><td>${fmtNum(ho.median, ' %')}</td></tr>
      <tr><td>Día más alto</td><td>${to.hottest_day ? `${esc(to.hottest_day.label)} (${to.hottest_day.avg} °C)` : '—'}</td><td>${ho.hottest_day ? `${esc(ho.hottest_day.label)} (${ho.hottest_day.avg} %)` : '—'}</td></tr>
      <tr><td>Día más bajo</td><td>${to.coldest_day ? `${esc(to.coldest_day.label)} (${to.coldest_day.avg} °C)` : '—'}</td><td>${ho.coldest_day ? `${esc(ho.coldest_day.label)} (${ho.coldest_day.avg} %)` : '—'}</td></tr>
    </tbody>
  </table>` : ''}

  <h2>Panorama del periodo</h2>
  <div class="kpi-grid">
    ${(agg.TEMP && agg.TEMP.peaks && agg.TEMP.peaks.hottest) ? `<div class="kpi"><div class="kpi-val">${agg.TEMP.peaks.hottest.value}°C</div><div class="kpi-label">Momento más caliente</div><div class="kpi-sub">${esc(agg.TEMP.peaks.hottest.ts_iso)}</div></div>` : ''}
    ${(agg.TEMP && agg.TEMP.peaks && agg.TEMP.peaks.coldest) ? `<div class="kpi"><div class="kpi-val">${agg.TEMP.peaks.coldest.value}°C</div><div class="kpi-label">Momento más frío</div><div class="kpi-sub">${esc(agg.TEMP.peaks.coldest.ts_iso)}</div></div>` : ''}
    ${hotHour !== null ? `<div class="kpi"><div class="kpi-val">${String(hotHour).padStart(2, '0')}:00</div><div class="kpi-label">Hora más caliente</div><div class="kpi-sub">en promedio ${hotHourVal}°C</div></div>` : ''}
    <div class="kpi"><div class="kpi-val">${(agg.TEMP && agg.TEMP.daily) ? agg.TEMP.daily.length : 0}</div><div class="kpi-label">Días con datos</div><div class="kpi-sub">${(agg.TEMP && agg.TEMP.samples) || 0} mediciones</div></div>
  </div>

  <h2>Estado actual por sensor</h2>
  <table class="data-table compact">
    <thead><tr><th>Sensor</th><th>Zona</th><th>Temp</th><th>Hum</th></tr></thead>
    <tbody>${currentRowsHtml}</tbody>
  </table>
</section>

<section class="page">
  <h1>Temperatura</h1>
  <p class="section-intro">Rango óptimo: <strong>${th.TEMP.min}–${th.TEMP.max} °C</strong>. Las gráficas muestran el promedio interior del complejo.</p>
  ${tempCharts}
</section>

<section class="page">
  <h1>Humedad</h1>
  <p class="section-intro">Rango óptimo: <strong>${th.HUM.min}–${th.HUM.max} %</strong>. Las gráficas muestran el promedio interior del complejo.</p>
  ${humCharts}
</section>

${weeklySection}

<section class="page">
  <h1>Eventos destacados</h1>
  ${c.events ? `<div class="prose">${c.events}</div>` : ''}
  <h2>Cronología de cambios de estado</h2>
  <table class="data-table compact">
    <thead><tr><th>Fecha y hora</th><th>Sensor</th><th>Cambio</th><th>Valor</th></tr></thead>
    <tbody>${alertRows}</tbody>
  </table>
</section>

<section class="page">
  <h1>Recomendaciones</h1>
  <div class="disclaimer"><em>Las siguientes sugerencias son generadas por inteligencia artificial a partir de los datos observados y no reemplazan el criterio del operador. Verifique con inspección visual antes de aplicar cambios.</em></div>
  <div class="prose">${c.recommendations || '<ul><li>Mantenga calibración rutinaria de los sensores.</li><li>Revise humidificación y ventilación si hay alertas persistentes.</li></ul>'}</div>
</section>

<footer class="report-end">
  <hr>
  <p class="muted small">Reporte generado automáticamente · Malinalco Render<br>
  Periodo: ${esc(meta.start_iso)} a ${esc(meta.end_iso)} · ${esc(meta.generated_iso)}</p>
</footer>

<script>
  window.__PAYLOAD = ${payload};
  ${clientChartsScript()}
  try { window.__renderCharts(); } catch (e) { console.error('charts', e); }
  setTimeout(() => { window.__chartsReady = true; }, 500);
</script>
</body></html>`;
}

// Renderiza el reporte a PDF + un PNG de preview (primera pagina = portada).
export async function renderReport(data, current, commentary, title) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // Viewport ~A4 @96dpi para que el layout cuadre con la pagina impresa.
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });
    await page.setContent(buildHtml(data, current, commentary, title), { waitUntil: 'networkidle0', timeout: 45000 });
    await page.waitForFunction('window.__chartsReady === true', { timeout: 10000 }).catch(() => {
      log.warn('charts no marcaron ready; imprimo de todas formas');
    });
    const pdf = await page.pdf({
      format: 'A4', printBackground: true, preferCSSPageSize: true,
    });
    let preview = null;
    try {
      preview = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 794, height: 1123 } });
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
