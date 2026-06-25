// Agregaciones temporales para el reporte ejecutivo.
//
// Portado de ai-predictor/app/reports/aggregations.py. Calcula TODO sobre la
// SERIE PROMEDIO INTERIOR (no el espagueti de 8 sensores): para cada minuto se
// promedian los sensores del grupo y sobre esa unica serie se derivan vistas que
// un lector NO especialista entiende:
//   - promedio por DIA            ¿que dias estuvieron mas calientes?
//   - perfil por HORA (0-23h)     ¿a que horas hace mas calor?
//   - agregacion por SEMANA       ¿cual fue la mejor/peor semana?
//   - matriz hora x dia (heatmap) vista completa de patrones
//   - momento PICO                el instante mas critico
//
// Malinalco tiene 8 sensores y TODOS son interiores (no hay tex/hex), asi que el
// "interior" = todas las variables del grupo. No hay serie exterior.

const DOW_ES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MONTH_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function round2(v) {
  return Math.round(v * 100) / 100;
}

function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Etiqueta legible "Lun 19 may"
function dayLabel(d) {
  return `${DOW_ES[d.getDay()]} ${d.getDate()} ${MONTH_ES[d.getMonth()]}`;
}

// Semana ISO (año-Wnn) de una fecha local.
function isoWeek(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayNum = d.getDay() || 7; // lunes=1..domingo=7
  d.setDate(d.getDate() + 4 - dayNum);
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

function median(vals) {
  if (!vals.length) return 0;
  const s = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function emptyAgg() {
  return { daily: [], hourly_profile: [], weekly: [], heatmap: null, peaks: {}, overall: {}, samples: 0 };
}

/**
 * @param {Array<{var:string,data:Array<[number,number]>}>} timeSeriesGroup series por sensor ([tsMs,val])
 * @param {number} lo umbral optimo inferior
 * @param {number} hi umbral optimo superior
 */
export function computeAggregations(timeSeriesGroup, lo, hi) {
  // Serie de PROMEDIO interior: agrupamos por minuto epoch y promediamos todos
  // los sensores que tengan dato en ese minuto (estan casi sincronizados).
  const byMinute = new Map(); // minuteKey -> [vals]
  for (const s of timeSeriesGroup || []) {
    for (const [tsMs, val] of s.data || []) {
      if (typeof val !== 'number' || Number.isNaN(val)) continue;
      const mk = Math.floor(tsMs / 60000);
      const arr = byMinute.get(mk);
      if (arr) arr.push(val);
      else byMinute.set(mk, [val]);
    }
  }
  if (!byMinute.size) return emptyAgg();

  // avgSeries: [tsSeg, avgVal] ordenada por tiempo.
  const avgSeries = [...byMinute.entries()]
    .map(([mk, vals]) => [mk * 60, vals.reduce((a, b) => a + b, 0) / vals.length])
    .sort((a, b) => a[0] - b[0]);

  const daily = byDay(avgSeries, lo, hi);
  return {
    daily,
    hourly_profile: byHourOfDay(avgSeries),
    weekly: byWeek(avgSeries, lo, hi),
    heatmap: heatmap(avgSeries),
    peaks: peaks(avgSeries),
    overall: overall(avgSeries, daily),
    samples: avgSeries.length,
  };
}

function byDay(series, lo, hi) {
  const buckets = new Map(); // dayKey -> [vals]
  for (const [ts, val] of series) {
    const d = new Date(ts * 1000);
    const k = dayKey(d);
    const arr = buckets.get(k);
    if (arr) arr.push(val);
    else buckets.set(k, [val]);
  }
  return [...buckets.keys()].sort().map((k) => {
    const vals = buckets.get(k);
    const n = vals.length;
    const inRange = vals.filter((v) => v >= lo && v <= hi).length;
    const [y, m, dd] = k.split('-').map(Number);
    const d = new Date(y, m - 1, dd);
    return {
      date: k,
      label: dayLabel(d),
      avg: round2(vals.reduce((a, b) => a + b, 0) / n),
      min: round2(Math.min(...vals)),
      max: round2(Math.max(...vals)),
      in_range_pct: round2((inRange / n) * 100),
      n,
    };
  });
}

function byHourOfDay(series) {
  const buckets = new Map(); // hour -> [vals]
  for (const [ts, val] of series) {
    const h = new Date(ts * 1000).getHours();
    const arr = buckets.get(h);
    if (arr) arr.push(val);
    else buckets.set(h, [val]);
  }
  const out = [];
  for (let h = 0; h < 24; h++) {
    const vals = buckets.get(h);
    if (vals && vals.length) {
      out.push({
        hour: h,
        label: `${String(h).padStart(2, '0')}:00`,
        avg: round2(vals.reduce((a, b) => a + b, 0) / vals.length),
        min: round2(Math.min(...vals)),
        max: round2(Math.max(...vals)),
        n: vals.length,
      });
    }
  }
  return out;
}

function byWeek(series, lo, hi) {
  const buckets = new Map(); // wkey -> [vals]
  for (const [ts, val] of series) {
    const wkey = isoWeek(new Date(ts * 1000));
    const arr = buckets.get(wkey);
    if (arr) arr.push(val);
    else buckets.set(wkey, [val]);
  }
  const weeks = [...buckets.keys()].sort().map((wkey) => {
    const vals = buckets.get(wkey);
    const n = vals.length;
    const inRange = vals.filter((v) => v >= lo && v <= hi).length;
    return {
      week: wkey,
      avg: round2(vals.reduce((a, b) => a + b, 0) / n),
      min: round2(Math.min(...vals)),
      max: round2(Math.max(...vals)),
      in_range_pct: round2((inRange / n) * 100),
      n,
      is_best: false,
      is_worst: false,
    };
  });
  if (weeks.length >= 2) {
    let best = weeks[0];
    let worst = weeks[0];
    for (const w of weeks) {
      if (w.in_range_pct > best.in_range_pct) best = w;
      if (w.in_range_pct < worst.in_range_pct) worst = w;
    }
    for (const w of weeks) {
      w.is_best = w.week === best.week;
      w.is_worst = w.week === worst.week && w.week !== best.week;
    }
  }
  return weeks;
}

// Matriz dia x hora con el promedio de cada celda. {days, day_keys, values[n][24]}.
function heatmap(series) {
  const cells = new Map(); // `${dayKey}|${hour}` -> [vals]
  const daysSeen = new Map(); // dayKey -> label corto "Lun 19"
  for (const [ts, val] of series) {
    const d = new Date(ts * 1000);
    const dk = dayKey(d);
    const h = d.getHours();
    const ck = `${dk}|${h}`;
    const arr = cells.get(ck);
    if (arr) arr.push(val);
    else cells.set(ck, [val]);
    if (!daysSeen.has(dk)) daysSeen.set(dk, `${DOW_ES[d.getDay()]} ${d.getDate()}`);
  }
  if (!daysSeen.size) return null;
  const sortedDays = [...daysSeen.keys()].sort();
  const values = sortedDays.map((dk) => {
    const row = [];
    for (let h = 0; h < 24; h++) {
      const vals = cells.get(`${dk}|${h}`);
      row.push(vals ? round2(vals.reduce((a, b) => a + b, 0) / vals.length) : null);
    }
    return row;
  });
  return { days: sortedDays.map((dk) => daysSeen.get(dk)), day_keys: sortedDays, values };
}

function peaks(series) {
  if (!series.length) return {};
  let hot = series[0];
  let cold = series[0];
  for (const p of series) {
    if (p[1] > hot[1]) hot = p;
    if (p[1] < cold[1]) cold = p;
  }
  const iso = (sec) => new Date(sec * 1000).toISOString().replace('T', ' ').slice(0, 16);
  return {
    hottest: { ts_iso: iso(hot[0]), value: round2(hot[1]) },
    coldest: { ts_iso: iso(cold[0]), value: round2(cold[1]) },
  };
}

function overall(series, daily) {
  if (!series.length) return {};
  const vals = series.map((p) => p[1]);
  const out = {
    avg: round2(vals.reduce((a, b) => a + b, 0) / vals.length),
    median: round2(median(vals)),
    min: round2(Math.min(...vals)),
    max: round2(Math.max(...vals)),
  };
  if (daily && daily.length) {
    let hottest = daily[0];
    let coldest = daily[0];
    for (const d of daily) {
      if (d.avg > hottest.avg) hottest = d;
      if (d.avg < coldest.avg) coldest = d;
    }
    out.hottest_day = { label: hottest.label, avg: hottest.avg };
    out.coldest_day = { label: coldest.label, avg: coldest.avg };
  }
  return out;
}
