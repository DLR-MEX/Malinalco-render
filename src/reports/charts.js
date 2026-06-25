// Graficas del reporte ejecutivo. A diferencia del render viejo (2 lineas con los
// 8 sensores encimados = espagueti ilegible), aqui cada grafica se calcula sobre
// el PROMEDIO interior (1 serie limpia) y hay variedad de tipos para que
// cualquiera lo entienda:
//   - heatmap hora x dia          (color = valor; verde = rango ideal)
//   - barras promedio por dia      (con banda del rango ideal)
//   - perfil del dia tipico        (curva por hora, marca la hora pico)
//   - % en rango por dia           (verde/ambar/rojo)
//   - comparativa semanal          (mejor vs peor, solo si >=2 semanas)
//
// Portado de charts.py (matplotlib) a ECharts. Como ECharts necesita funciones
// (formatters) que no sobreviven a JSON.stringify, las graficas se DIBUJAN en la
// pagina headless: este modulo exporta el codigo cliente como string que render.js
// inyecta en un <script>. El codigo lee `window.__PAYLOAD.data.aggregations`.

// Paleta calcada de charts.py — coherente con el dashboard.
export const CHART_COLORS = {
  BG_LIGHT: '#fdfcf7',
  GRID: '#cbd5e1',
  TEXT: '#1a2630',
  SUBTLE: '#607888',
  COL_TEMP: '#e07a3f',
  COL_HUM: '#3b82f6',
  COL_OK: '#16a34a',
  COL_WARN: '#f59e0b',
  COL_DANGER: '#ef4444',
  COL_IDEAL: '#86efac',
  HEAT: ['#2563eb', '#22c55e', '#facc15', '#ef4444'],
};

// Topes FIJOS de escala para los heatmaps (mismo valor = mismo color entre
// reportes). Humedad siempre 0-100; temperatura 0-45.
export const HEATMAP_MAX = { TEMP: 45, HUM: 100 };

// Devuelve el codigo JS (string) que se inyecta en la pagina headless. Define
// window.__renderCharts() que dibuja todas las graficas presentes en el DOM.
export function clientChartsScript() {
  const C = JSON.stringify(CHART_COLORS);
  const HMAX = JSON.stringify(HEATMAP_MAX);
  return `
const C = ${C};
const HEATMAP_MAX = ${HMAX};
const _charts = [];

function _baseGrid() { return { left: 52, right: 24, top: 28, bottom: 40, containLabel: true }; }
function _initInto(id) {
  const el = document.getElementById(id);
  if (!el || !window.echarts) return null;
  const ch = window.echarts.init(el, null, { renderer: 'canvas', devicePixelRatio: 2 });
  _charts.push(ch);
  return ch;
}

function drawHeatmap(id, hm, unit, group, lo, hi) {
  if (!hm || !hm.values || !hm.values.length) return;
  const ch = _initInto(id); if (!ch) return;
  const hours = []; for (let h = 0; h < 24; h++) hours.push(String(h).padStart(2,'0') + 'h');
  const data = [];
  for (let i = 0; i < hm.values.length; i++) {
    for (let h = 0; h < 24; h++) {
      const v = hm.values[i][h];
      if (v !== null && v !== undefined) data.push([h, i, Math.round(v * 10) / 10]);
    }
  }
  const showLabels = hm.days.length <= 16;
  const vmax = HEATMAP_MAX[group] || 100;
  ch.setOption({
    animation: false,
    grid: { left: 52, right: 16, top: 12, bottom: 60, containLabel: true },
    tooltip: {},
    xAxis: { type: 'category', data: hours, splitArea: { show: true },
      axisLabel: { fontSize: 8, color: C.TEXT, interval: 1 } },
    yAxis: { type: 'category', data: hm.days, splitArea: { show: true },
      axisLabel: { fontSize: 8, color: C.TEXT } },
    visualMap: { min: 0, max: vmax, calculable: true, orient: 'horizontal',
      left: 'center', bottom: 0, itemHeight: 90, textStyle: { fontSize: 8, color: C.TEXT },
      inRange: { color: C.HEAT }, text: ['alto', 'bajo'] },
    series: [{
      type: 'heatmap', data, progressive: 0,
      label: { show: showLabels, fontSize: 7, color: C.TEXT,
        formatter: (p) => Math.round(p.data[2]) },
      emphasis: { itemStyle: { shadowBlur: 6, shadowColor: 'rgba(0,0,0,0.3)' } },
    }],
  });
}

function drawDailyBars(id, daily, unit, color, lo, hi) {
  if (!daily || !daily.length) return;
  const ch = _initInto(id); if (!ch) return;
  const labels = daily.map((d) => d.label);
  const avgs = daily.map((d) => d.avg);
  const markArea = (lo != null && hi != null)
    ? { silent: true, itemStyle: { color: C.COL_IDEAL, opacity: 0.30 },
        data: [[{ yAxis: lo }, { yAxis: hi }]] }
    : undefined;
  ch.setOption({
    animation: false, grid: _baseGrid(),
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: labels,
      axisLabel: { fontSize: 8, color: C.TEXT, rotate: 28 } },
    yAxis: { type: 'value', name: unit, nameTextStyle: { fontSize: 8, color: C.SUBTLE },
      axisLabel: { fontSize: 8, color: C.TEXT }, splitLine: { lineStyle: { color: C.GRID, opacity: 0.5 } } },
    series: [{
      type: 'bar', data: avgs, itemStyle: { color, borderColor: '#fff', borderWidth: 1 },
      barMaxWidth: 46, markArea,
      label: { show: true, position: 'top', fontSize: 8, fontWeight: 'bold', color: C.TEXT,
        formatter: (p) => (Math.round(p.value * 10) / 10) },
    }],
  });
}

function drawHourly(id, hourly, unit, color, lo, hi) {
  if (!hourly || !hourly.length) return;
  const ch = _initInto(id); if (!ch) return;
  const xs = hourly.map((d) => String(d.hour).padStart(2, '0') + 'h');
  const avgs = hourly.map((d) => d.avg);
  let peakIdx = 0; for (let i = 1; i < avgs.length; i++) if (avgs[i] > avgs[peakIdx]) peakIdx = i;
  const markArea = (lo != null && hi != null)
    ? { silent: true, itemStyle: { color: C.COL_IDEAL, opacity: 0.28 },
        data: [[{ yAxis: lo }, { yAxis: hi }]] }
    : undefined;
  ch.setOption({
    animation: false, grid: _baseGrid(),
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: xs, boundaryGap: false,
      axisLabel: { fontSize: 8, color: C.TEXT } },
    yAxis: { type: 'value', name: unit, nameTextStyle: { fontSize: 8, color: C.SUBTLE },
      scale: true, axisLabel: { fontSize: 8, color: C.TEXT },
      splitLine: { lineStyle: { color: C.GRID, opacity: 0.5 } } },
    series: [{
      type: 'line', data: avgs, smooth: true, symbol: 'circle', symbolSize: 4,
      lineStyle: { width: 2.4, color }, itemStyle: { color },
      areaStyle: { color, opacity: 0.14 }, markArea,
      markPoint: { symbol: 'circle', symbolSize: 11, data: [{ coord: [peakIdx, avgs[peakIdx]] }],
        itemStyle: { color: C.COL_DANGER, borderColor: '#fff', borderWidth: 1.5 },
        label: { show: true, position: 'top', fontSize: 8, fontWeight: 'bold', color: C.COL_DANGER,
          formatter: () => 'pico ' + (Math.round(avgs[peakIdx] * 10) / 10) } },
    }],
  });
}

function drawInRange(id, daily) {
  if (!daily || !daily.length) return;
  const ch = _initInto(id); if (!ch) return;
  const labels = daily.map((d) => d.label);
  const data = daily.map((d) => {
    const p = d.in_range_pct || 0;
    const color = p >= 80 ? C.COL_OK : (p >= 50 ? C.COL_WARN : C.COL_DANGER);
    return { value: p, itemStyle: { color, borderColor: '#fff', borderWidth: 1 } };
  });
  ch.setOption({
    animation: false, grid: _baseGrid(),
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: labels, axisLabel: { fontSize: 8, color: C.TEXT, rotate: 28 } },
    yAxis: { type: 'value', max: 112, name: '% en rango', nameTextStyle: { fontSize: 8, color: C.SUBTLE },
      axisLabel: { fontSize: 8, color: C.TEXT }, splitLine: { lineStyle: { color: C.GRID, opacity: 0.5 } } },
    series: [{ type: 'bar', data, barMaxWidth: 46,
      label: { show: true, position: 'top', fontSize: 8, fontWeight: 'bold', color: C.TEXT,
        formatter: (p) => (Math.round(p.value) + '%') } }],
  });
}

function drawWeekly(id, weekly) {
  if (!weekly || weekly.length < 2) return;
  const ch = _initInto(id); if (!ch) return;
  const labels = weekly.map((w) => 'Sem ' + w.week.split('-W').pop());
  const data = weekly.map((w) => {
    const color = w.is_best ? C.COL_OK : (w.is_worst ? C.COL_DANGER : '#94a3b8');
    return { value: w.in_range_pct, itemStyle: { color, borderColor: '#fff', borderWidth: 1 },
      _tag: w.is_best ? ' (mejor)' : (w.is_worst ? ' (peor)' : '') };
  });
  ch.setOption({
    animation: false, grid: _baseGrid(),
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: labels, axisLabel: { fontSize: 9, color: C.TEXT } },
    yAxis: { type: 'value', max: 112, name: '% en rango', nameTextStyle: { fontSize: 8, color: C.SUBTLE },
      axisLabel: { fontSize: 8, color: C.TEXT }, splitLine: { lineStyle: { color: C.GRID, opacity: 0.5 } } },
    series: [{ type: 'bar', data, barMaxWidth: 60,
      label: { show: true, position: 'top', fontSize: 9, fontWeight: 'bold', color: C.TEXT,
        formatter: (p) => (Math.round(p.value) + '%' + (p.data._tag || '')) } }],
  });
}

window.__renderCharts = function () {
  const D = (window.__PAYLOAD && window.__PAYLOAD.data) || {};
  const agg = D.aggregations || {};
  const th = D.thresholds || {};
  const groups = [
    ['TEMP', '°C', C.COL_TEMP],
    ['HUM', '%', C.COL_HUM],
  ];
  for (const [g, unit, color] of groups) {
    const a = agg[g]; if (!a) continue;
    const lo = th[g] ? th[g].min : null;
    const hi = th[g] ? th[g].max : null;
    const p = g.toLowerCase();
    drawHeatmap(p + '_heatmap', a.heatmap, unit, g, lo, hi);
    drawHourly(p + '_hourly', a.hourly_profile, unit, color, lo, hi);
    drawDailyBars(p + '_daily', a.daily, unit, color, lo, hi);
    drawInRange(p + '_in_range', a.daily);
    drawWeekly(p + '_weekly', a.weekly);
  }
};
`;
}
