// Registro de tools del agente. Cada tool es PURA (solo lectura). El registro
// se arma dinamicamente segun las dependencias disponibles, asi cada fase del
// port habilita mas tools sin tocar el loop del agente:
//   - Fase 1 (store):    get_current_state, get_thresholds
//   - Fase 2 (ubidots):  get_history_ubidots, plot_history
//   - Fase 3 (alertLog): get_recent_alerts
//   - Fase 4 (reports):  generate_report, schedule_report, list/cancel
//
// createTools({ store, ubidots, alertLog, reports }) -> { schemas, execute(name,args) }

import { SENSORS, ZONES, DEVICE, ALL_VARIABLES } from '../sensorsMap.js';
import {
  TEMP_ALERT_LOW, TEMP_ALERT_HIGH, HUM_ALERT_LOW, HUM_ALERT_HIGH,
} from '../config.js';
import { classify, rangeFor, GROUP_UNITS } from '../thresholds.js';

function thresholdsObject() {
  return {
    TEMP: { min: TEMP_ALERT_LOW, max: TEMP_ALERT_HIGH, unit: '°C' },
    HUM: { min: HUM_ALERT_LOW, max: HUM_ALERT_HIGH, unit: '%' },
  };
}

function round1(v) {
  return typeof v === 'number' ? Math.round(v * 10) / 10 : null;
}

// ---- Fase 1: estado actual + rangos ----

function toolCurrentState(store) {
  const zones = ZONES.map((zone) => {
    const sensors = SENSORS.filter((s) => s.zone === zone.id).map((s) => {
      const t = s.tempVariable ? store.get(DEVICE, s.tempVariable) : null;
      const h = s.humVariable ? store.get(DEVICE, s.humVariable) : null;
      const tv = t ? t.value : null;
      const hv = h ? h.value : null;
      return {
        id: s.id,
        label: s.sidebarLabel,
        temp: { value: round1(tv), state: classify(tv, 'TEMP') },
        hum: { value: round1(hv), state: classify(hv, 'HUM') },
      };
    });
    const tVals = sensors.map((x) => x.temp.value).filter((v) => v !== null);
    const hVals = sensors.map((x) => x.hum.value).filter((v) => v !== null);
    const avg = (arr) => (arr.length ? round1(arr.reduce((a, b) => a + b, 0) / arr.length) : null);
    return {
      id: zone.id,
      label: zone.label,
      sensors,
      temp_avg: avg(tVals),
      hum_avg: avg(hVals),
    };
  });

  const lastUpdate = store.getAll().lastUpdate;
  return {
    device: DEVICE,
    now_iso: new Date().toISOString(),
    last_update_iso: lastUpdate ? new Date(lastUpdate).toISOString() : null,
    thresholds: thresholdsObject(),
    zones,
    _note: 'Todos los sensores son interiores. state ok|abnormal|unknown segun rango optimo.',
  };
}

// ---- Fase 2: historico Ubidots ----

// Grupo (TEMP/HUM) a partir del sufijo de la variable Ubidots.
function groupOfVar(label) {
  if (label.endsWith('_temperature')) return 'TEMP';
  if (label.endsWith('_humidity')) return 'HUM';
  return null;
}

// Etiqueta legible del sensor dueño de una variable (ej. "ENG·C").
function sensorLabelOfVar(label) {
  const s = SENSORS.find((x) => x.tempVariable === label || x.humVariable === label);
  return s ? s.sidebarLabel : label;
}

// Resuelve la entrada `var` del LLM a una variable Ubidots valida. Acepta el
// label directo (sith3_temperature) y normaliza mayusculas/espacios.
function resolveVarLabel(input) {
  const v = String(input || '').trim();
  if (!v) return null;
  if (ALL_VARIABLES.includes(v)) return v;
  const lower = v.toLowerCase();
  const hit = ALL_VARIABLES.find((x) => x.toLowerCase() === lower);
  return hit || null;
}

function summarizeRows(rows) {
  const values = rows.map((r) => r.value).filter((x) => typeof x === 'number' && !Number.isNaN(x));
  if (!values.length) return null;
  const n = values.length;
  let min = Infinity, max = -Infinity, sum = 0;
  for (const x of values) { if (x < min) min = x; if (x > max) max = x; sum += x; }
  return { count: n, min: round1(min), max: round1(max), avg: round1(sum / n) };
}

// Reduce N puntos a ~targetN para no saturar el contexto del LLM (las graficas
// usan todos los puntos via chart_spec; esto es solo para el resumen textual).
function downsample(rows, targetN = 40) {
  if (rows.length <= targetN) return rows;
  const step = Math.ceil(rows.length / targetN);
  return rows.filter((_, i) => i % step === 0);
}

async function toolHistory(ubidots, args) {
  const label = resolveVarLabel(args.var);
  if (!label) {
    return { error: `Variable '${args.var}' no reconocida. Validas: ${ALL_VARIABLES.join(', ')}` };
  }
  let hours = Number(args.hours) || 6;
  hours = Math.max(0.1, Math.min(hours, 168)); // 0.1h .. 7 dias
  const endMs = Date.now();
  const startMs = endMs - hours * 3600 * 1000;

  const rows = await ubidots.getValuesRangeByLabel(DEVICE, label, startMs, endMs);
  if (!rows.length) {
    return { var: label, hours, samples: [], error: 'sin datos en el periodo' };
  }
  const group = groupOfVar(label);
  const summary = summarizeRows(rows);
  // % del tiempo fuera de rango (solo si es temp/hum, que en Malinalco son todas)
  let timeOutsidePct = null;
  if (group) {
    const { low, high } = rangeFor(group);
    const outside = rows.filter((r) => typeof r.value === 'number' && (r.value < low || r.value > high)).length;
    timeOutsidePct = Math.round((outside / rows.length) * 100);
  }
  const samples = downsample(rows).map((r) => ({
    ts_iso: new Date(r.timestamp).toISOString(),
    value: round1(r.value),
  }));
  return {
    var: label,
    sensor: sensorLabelOfVar(label),
    group,
    unit: group ? GROUP_UNITS[group] : '',
    hours,
    summary,
    time_outside_pct: timeOutsidePct,
    current_state: group ? classify(rows[rows.length - 1].value, group) : null,
    samples,
    _note: 'samples esta submuestreado; usa summary (min/max/avg) para reportar.',
  };
}

const PLOT_COLORS = ['#E8B830', '#4FC3F7', '#81C784', '#FF8A65', '#BA68C8', '#A1887F'];

async function toolPlot(ubidots, args) {
  let vars = Array.isArray(args.vars) ? args.vars : (args.vars ? [args.vars] : []);
  vars = vars.map(resolveVarLabel).filter(Boolean).slice(0, 6);
  if (!vars.length) {
    return { error: `Sin variables validas. Validas: ${ALL_VARIABLES.join(', ')}` };
  }
  let hours = Number(args.hours) || 6;
  hours = Math.max(0.1, Math.min(hours, 168));
  const endMs = Date.now();
  const startMs = endMs - hours * 3600 * 1000;

  const groups = new Set(vars.map(groupOfVar));
  const sameGroup = groups.size === 1 ? [...groups][0] : null;

  const series = [];
  const statLines = [];
  for (let i = 0; i < vars.length; i++) {
    const label = vars[i];
    const rows = await ubidots.getValuesRangeByLabel(DEVICE, label, startMs, endMs);
    series.push({
      name: sensorLabelOfVar(label),
      color: PLOT_COLORS[i % PLOT_COLORS.length],
      data: rows.map((r) => [r.timestamp, round1(r.value)]),
    });
    const sum = summarizeRows(rows);
    if (sum) statLines.push(`${sensorLabelOfVar(label)}: min ${sum.min}, max ${sum.max}, avg ${sum.avg}`);
  }

  const chartSpec = {
    title: args.title || `Histórico ${hours}h`,
    unit: sameGroup ? GROUP_UNITS[sameGroup] : '',
    series,
  };
  if (sameGroup) {
    const { low, high } = rangeFor(sameGroup);
    chartSpec.thresholds = { min: low, max: high };
  }

  return {
    chart_spec: chartSpec,
    summary: statLines.join(' · '),
    _note: 'La grafica se renderiza inline en el widget. Añade solo un comentario '
      + 'breve con stats (min/max/avg, picos, tendencias); NO repitas los puntos.',
  };
}

// ---- Fase 3: alertas recientes (AlertLog) ----

function tsIso(sec) {
  return new Date(sec * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

// Sensores actualmente en estado abnormal (clasificacion stateless contra el
// rango optimo). Critico: el AlertLog solo guarda TRANSICIONES, asi que un sensor
// que ya estaba fuera de rango antes de la ventana no aparece como transicion.
function currentlyAbnormal(store, { groupFilter = null, varFilter = null } = {}) {
  const out = [];
  for (const s of SENSORS) {
    for (const [group, varLabel] of [['TEMP', s.tempVariable], ['HUM', s.humVariable]]) {
      if (!varLabel) continue;
      if (groupFilter && groupFilter !== group) continue;
      if (varFilter && varFilter !== varLabel) continue;
      const reading = store.get(DEVICE, varLabel);
      const value = reading ? reading.value : null;
      if (classify(value, group) === 'abnormal') {
        out.push({ var: varLabel, sensor: s.sidebarLabel, group, current_value: round1(value) });
      }
    }
  }
  return out;
}

function toolRecentAlerts(store, alertLog, args) {
  let hours = Number(args.hours) || 24;
  hours = Math.max(0.1, Math.min(hours, 24 * 30)); // 0.1h .. 30 dias
  const nowSec = Date.now() / 1000;
  const sinceTs = nowSec - hours * 3600;

  // El LLM a veces manda valores invalidos (ej. "interior", "all"): toleramos.
  const groupFilter = args.group === 'TEMP' || args.group === 'HUM' ? args.group : null;
  let varFilter = args.var || null;
  if (varFilter && !ALL_VARIABLES.includes(varFilter)) varFilter = null;

  const rows = alertLog.query({ group: groupFilter, var: varFilter, sinceTs, limit: 100 });

  const transitions = [];
  const jumps = [];
  for (const r of rows) {
    if (r.kind === 'jump') {
      jumps.push({
        ts_iso: tsIso(r.ts), group: r.group_name, var: r.var,
        from_value: r.prev_state, to_value: r.new_state, delta: r.predicted_value,
      });
    } else {
      transitions.push({
        ts_iso: tsIso(r.ts), group: r.group_name, var: r.var,
        transition: `${r.prev_state}->${r.new_state}`, kind: r.kind, value: r.value,
      });
    }
  }

  const total = alertLog.count({ group: groupFilter, newState: 'abnormal', sinceTs });
  const abnormalNow = currentlyAbnormal(store, { groupFilter, varFilter });

  const oldestTs = alertLog.oldestTs();
  const logOldestIso = oldestTs ? tsIso(oldestTs) : null;
  const logAgeHours = oldestTs ? (nowSec - oldestTs) / 3600 : 0;
  const logCoversFullPeriod = oldestTs !== null && (nowSec - oldestTs) >= hours * 3600 - 60;

  // Pista interpretativa: 0 transiciones pero hay sensores abnormal => ya estaban
  // fuera de rango antes de la ventana consultada.
  let interpretation = '';
  if (total === 0 && abnormalNow.length && rows.length === 0) {
    const sensors = abnormalNow.map((s) => s.var).join(', ');
    if (!logCoversFullPeriod) {
      interpretation = `NOTA CRITICA: 0 transiciones, PERO el AlertLog solo tiene ${logAgeHours.toFixed(1)}h de historico `
        + `(arranco en ${logOldestIso}); NO cubre todo el periodo de ${hours.toFixed(0)}h solicitado. Los sensores `
        + `${sensors} estan abnormal AHORA. Para saber DESDE CUANDO, usa get_history_ubidots(var='${abnormalNow[0].var}', hours=24) `
        + 'y busca el primer punto fuera de rango.';
    } else {
      interpretation = `NOTA: 0 transiciones en el periodo, PERO ${sensors} estan actualmente abnormal. Como el AlertLog si `
        + `cubre el periodo (${logAgeHours.toFixed(1)}h de historico), la anomalia es persistente desde antes del inicio del periodo.`;
    }
  }

  return {
    hours_back: hours,
    filters: { ...(groupFilter ? { group: groupFilter } : {}), ...(varFilter ? { var: varFilter } : {}) },
    transitions_to_abnormal: total,
    transitions_returned: transitions.length,
    transitions,
    jumps_detected: jumps.length,
    jumps,
    currently_abnormal_sensors: abnormalNow,
    alert_log_oldest_ts_iso: logOldestIso,
    alert_log_covers_full_period: logCoversFullPeriod,
    interpretation_hint: interpretation,
  };
}

// ---- Fase 4: reportes PDF + scheduling ----

// Resuelve el rango [startMs, endMs] desde los args del LLM. Solo usa `hours`
// si es positivo (un hours=0 de relleno no debe ganarle a start_iso/end_iso).
function resolveRange(args) {
  const now = Date.now();
  const hoursArg = args.hours;
  let hoursVal = null;
  if (hoursArg !== undefined && hoursArg !== null) {
    hoursVal = Number(hoursArg);
    if (Number.isNaN(hoursVal)) throw new Error('hours debe ser numerico');
  }
  let startMs;
  let endMs;
  if (hoursVal && hoursVal > 0) {
    const hours = Math.max(0.1, Math.min(hoursVal, 744)); // 31 dias max
    endMs = now;
    startMs = now - hours * 3600 * 1000;
  } else if (args.start_iso && args.end_iso) {
    startMs = Date.parse(args.start_iso);
    endMs = Date.parse(args.end_iso);
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) throw new Error('fechas ISO invalidas');
  } else {
    endMs = now;
    startMs = now - 24 * 3600 * 1000;
  }
  if (endMs <= startMs) throw new Error('end debe ser mayor a start');
  return { startMs, endMs };
}

async function toolGenerateReport(reports, args) {
  let range;
  try {
    range = resolveRange(args);
  } catch (e) {
    return { error: e.message };
  }
  try {
    const card = await reports.generate({
      startMs: range.startMs,
      endMs: range.endMs,
      title: args.title || null,
      sendToTelegram: Boolean(args.send_to_telegram),
    });
    return {
      report_card: card,
      _note: 'El reporte PDF se renderizo y guardo. El widget mostrara una tarjeta con preview y '
        + 'boton de descarga. En tu respuesta menciona brevemente que generaste el reporte (1-2 lineas), '
        + 'el periodo y los conteos clave. NO repitas la URL — el widget la presentara como boton.',
    };
  } catch (e) {
    return { error: `Error generando reporte: ${e.message}` };
  }
}

// ---- ensamblado del registro ----

export function createTools({ store, ubidots = null, alertLog = null, reports = null, scheduler = null } = {}) {
  const handlers = {};
  const schemas = [];

  // get_current_state
  schemas.push({
    type: 'function',
    function: {
      name: 'get_current_state',
      description: 'Devuelve el estado actual del complejo: por cada zona, sus sensores con valor '
        + 'actual de temperatura y humedad, su estado (ok/abnormal/unknown) y los promedios de zona. '
        + "Usalo para '¿como estan las zonas ahora?' o '¿hay algun sensor en alerta?'.",
      parameters: { type: 'object', properties: {}, required: [] },
    },
  });
  handlers.get_current_state = () => toolCurrentState(store);

  // get_thresholds
  schemas.push({
    type: 'function',
    function: {
      name: 'get_thresholds',
      description: 'Devuelve los rangos optimos configurados: TEMP {min,max} en °C y HUM {min,max} en %. '
        + "Valores fuera de estos rangos se consideran 'anormal'.",
      parameters: { type: 'object', properties: {}, required: [] },
    },
  });
  handlers.get_thresholds = () => thresholdsObject();

  // Fase 2: historico Ubidots (solo si hay cliente HTTP disponible).
  if (ubidots) {
    schemas.push({
      type: 'function',
      function: {
        name: 'get_history_ubidots',
        description: 'Pulla el historico real de una variable desde Ubidots y devuelve un resumen '
          + "(min/max/avg, % de tiempo fuera de rango) mas muestras. Usalo para '¿cual fue la "
          + "temperatura promedio de ENG·C las ultimas 6 horas?' o '¿cuando bajo la humedad?'.",
        parameters: {
          type: 'object',
          properties: {
            var: {
              type: 'string',
              description: `Variable Ubidots a consultar. Validas: ${ALL_VARIABLES.join(', ')}.`,
            },
            hours: { type: 'number', description: 'Horas hacia atras (default 6, max 168 = 7 dias).' },
          },
          required: ['var'],
        },
      },
    });
    handlers.get_history_ubidots = (args) => toolHistory(ubidots, args);

    schemas.push({
      type: 'function',
      function: {
        name: 'plot_history',
        description: 'Genera una GRAFICA de lineas con el historico de una o varias variables. Se '
          + "dibuja inline en el chat. Usala cuando el usuario pida 'grafica', 'plot', 'curva' o "
          + "'visualizacion'. Para comparar varias, pasalas en 'vars' como lista.",
        parameters: {
          type: 'object',
          properties: {
            vars: {
              type: 'array',
              items: { type: 'string' },
              description: `Variables a graficar (min 1, max 6). Validas: ${ALL_VARIABLES.join(', ')}.`,
            },
            hours: { type: 'number', description: 'Horas hacia atras (default 6, max 168).' },
            title: { type: 'string', description: 'Titulo opcional para la grafica.' },
          },
          required: ['vars'],
        },
      },
    });
    handlers.plot_history = (args) => toolPlot(ubidots, args);
  }

  // Fase 3: alertas recientes (solo si hay AlertLog disponible).
  if (alertLog) {
    schemas.push({
      type: 'function',
      function: {
        name: 'get_recent_alerts',
        description: 'Devuelve las alertas recientes: transiciones de estado (ok<->abnormal), saltos bruscos '
          + 'y los sensores ACTUALMENTE fuera de rango. Usalo para "¿hubo anomalias hoy?", "¿que sensores '
          + 'estan en alerta?" o "¿hubo cambios bruscos?". Lee tambien interpretation_hint si viene.',
        parameters: {
          type: 'object',
          properties: {
            hours: { type: 'number', description: 'Horas hacia atras (default 24, max 720 = 30 dias).' },
            group: { type: 'string', enum: ['TEMP', 'HUM'], description: 'Filtra por magnitud (opcional).' },
            var: {
              type: 'string',
              description: `Filtra por una variable Ubidots (opcional). Validas: ${ALL_VARIABLES.join(', ')}.`,
            },
          },
          required: [],
        },
      },
    });
    handlers.get_recent_alerts = (args) => toolRecentAlerts(store, alertLog, args);
  }

  // Fase 4: reportes PDF (solo si hay ReportsService disponible).
  if (reports) {
    schemas.push({
      type: 'function',
      function: {
        name: 'generate_report',
        description: 'Genera un reporte PDF ejecutivo del periodo indicado (estado actual, stats por sensor, '
          + 'graficas de tendencia y alertas). Usalo para "genera un reporte de la ultima semana" o "reporte '
          + 'de ayer". El widget muestra una tarjeta con preview + descarga. Tarda varios segundos.',
        parameters: {
          type: 'object',
          properties: {
            hours: { type: 'number', description: 'Horas hacia atras (ej. 24 = ultimo dia, 168 = semana). Max 744.' },
            start_iso: { type: 'string', description: 'Inicio ISO (alternativa a hours). Ej. 2026-06-10.' },
            end_iso: { type: 'string', description: 'Fin ISO (junto con start_iso).' },
            title: { type: 'string', description: 'Titulo opcional del reporte.' },
            send_to_telegram: { type: 'boolean', description: 'Si true, ademas entrega el PDF por Telegram.' },
          },
          required: [],
        },
      },
    });
    handlers.generate_report = (args) => toolGenerateReport(reports, args);
  }

  // Fase 4: scheduling de reportes (solo si hay scheduler disponible).
  if (scheduler) {
    schemas.push({
      type: 'function',
      function: {
        name: 'schedule_report',
        description: 'Programa un reporte recurrente. Usa friendly_cron en lenguaje natural ("diario 8am", '
          + '"lunes 9am") o cron estandar. period_kind define el rango: daily/weekly/monthly.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Nombre del schedule (requerido).' },
            friendly_cron: { type: 'string', description: 'Horario en lenguaje natural: "diario 8am", "lunes 9am", "viernes 6pm".' },
            cron: { type: 'string', description: 'Cron estandar de 5 campos (alternativa a friendly_cron).' },
            period_kind: { type: 'string', enum: ['daily', 'weekly', 'monthly'], description: 'Rango del reporte (default daily).' },
            deliver_to: { type: 'array', items: { type: 'string', enum: ['disk', 'telegram'] }, description: "Entrega: ['disk'] y/o ['telegram']." },
          },
          required: ['name'],
        },
      },
    });
    handlers.schedule_report = (args) => {
      const name = (args.name || '').trim();
      if (!name) return { error: 'name requerido' };
      try {
        const r = scheduler.add({
          name,
          cron: args.cron,
          friendlyCron: args.friendly_cron,
          periodKind: args.period_kind || 'daily',
          deliverTo: Array.isArray(args.deliver_to) && args.deliver_to.length ? args.deliver_to : ['disk'],
        });
        return {
          ok: true, ...r,
          _note: 'Schedule registrado (persiste reinicios). Avisa al usuario el nombre, horario (cron) y next_run.',
        };
      } catch (e) {
        return { error: e.message };
      }
    };

    schemas.push({
      type: 'function',
      function: {
        name: 'list_scheduled_reports',
        description: 'Lista los reportes programados (con su proximo disparo).',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    });
    handlers.list_scheduled_reports = () => ({ schedules: scheduler.list() });

    schemas.push({
      type: 'function',
      function: {
        name: 'cancel_report_schedule',
        description: 'Cancela un reporte programado por su schedule_id (obtenlo con list_scheduled_reports).',
        parameters: {
          type: 'object',
          properties: { schedule_id: { type: 'string', description: 'ID del schedule a cancelar.' } },
          required: ['schedule_id'],
        },
      },
    });
    handlers.cancel_report_schedule = (args) => {
      const id = (args.schedule_id || '').trim();
      if (!id) return { error: 'schedule_id requerido' };
      return { ok: scheduler.remove(id), schedule_id: id };
    };
  }

  async function execute(name, args) {
    const h = handlers[name];
    if (!h) return { error: `tool desconocida: ${name}` };
    return await h(args || {});
  }

  return { schemas, execute, handlers };
}
