// Narrativa del reporte ejecutivo redactada por el LLM (AgentService).
//
// Portado de ai-predictor/app/reports/commentary.py. Genera 3-4 secciones en
// llamadas paralelas e independientes al agente; si el agente no esta listo o una
// llamada falla, cae a un fallback estatico para que el reporte SIEMPRE salga
// legible (con o sin Ollama).
//
// Output: { summary, events, recommendations, weekly? } con HTML listo para
// inyectar en la plantilla.

import { getLogger } from '../logger.js';

const log = getLogger('reports.commentary');

const SYSTEM_PROMPT = `Eres quien redacta un reporte ejecutivo del monitoreo ambiental \
de los invernaderos Acopinalco (complejo de tuneles con sensores de temperatura y \
humedad). Lo lee gente que NO es tecnica: dueños, supervisores, operadores. Tu rol:

- Escribe en español SENCILLO y claro, como si le explicaras a alguien que no sabe
  de sensores ni de estadistica.
- EVITA jerga tecnica. No digas "desviacion estandar", "transicion de estado".
  Di las cosas simple: "se salio del rango", "hubo un cambio brusco".
- Usa contexto: en vez de "27.3 grados promedio", di "una temperatura agradable,
  dentro de lo ideal" o "mas caliente de lo recomendado".
- Se concreto y breve. Cumple el largo solicitado.
- USA los datos que se te pasan; NO inventes numeros ni eventos.
- Si los datos son escasos o nulos, dilo claramente y sin alarmar.
- Markdown ligero: **negritas** para lo importante, listas con guiones.
  NO uses titulos (#, ##) — el reporte ya los tiene.
- NO uses emojis. Es un documento profesional.
- NO repitas las fechas del periodo en cada seccion.`;

/**
 * @param {object|null} agent AgentService (puede ser null o no estar listo)
 * @param {object} data dict del collector
 * @returns {Promise<{summary:string,events:string,recommendations:string,weekly?:string}>}
 */
export async function generateCommentary(agent, data) {
  const weeklyTemp = ((data.aggregations || {}).TEMP || {}).weekly || [];

  const tasks = [
    ['summary', promptSummary, fallbackSummary],
    ['events', promptEvents, fallbackEvents],
    ['recommendations', promptRecommendations, fallbackRecommendations],
  ];
  if (weeklyTemp.length >= 2) tasks.push(['weekly', promptWeekly, fallbackWeekly]);

  const ready = Boolean(agent && agent.ready);
  if (!ready) {
    log.info('Agente IA no disponible — commentary usara fallbacks estaticos');
  }

  const entries = await Promise.all(
    tasks.map(async ([name, promptFn, fallbackFn]) => {
      const fallback = fallbackFn(data);
      if (!ready) return [name, fallback];
      try {
        const prompt = promptFn(data);
        if (!prompt) return [name, fallback];
        const result = await agent.chat(
          [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: prompt },
          ],
          { disableTools: true },
        );
        const reply = ((result || {}).reply || '').trim();
        if (!reply) {
          log.warn(`Seccion '${name}' devolvio vacio — usando fallback`);
          return [name, fallback];
        }
        return [name, markdownToHtml(reply)];
      } catch (e) {
        log.warn(`Seccion '${name}' fallo (${e.message}) — usando fallback`);
        return [name, fallback];
      }
    }),
  );

  return Object.fromEntries(entries);
}

// ---------- prompts por seccion ----------

function outOfRangeList(history, group, unit) {
  const out = [];
  for (const [v, s] of Object.entries(history || {})) {
    if ((s.time_outside_pct || 0) > 0) {
      out.push(`${s.sensor || v} (${s.time_outside_pct}% fuera, prom ${s.avg}${unit}, rango ${s.min}-${s.max}${unit})`);
    }
  }
  return out;
}

function promptSummary(data) {
  const { meta, alerts } = data;
  const out = [
    ...outOfRangeList(data.history.TEMP, 'TEMP', '°C'),
    ...outOfRangeList(data.history.HUM, 'HUM', '%'),
  ];
  return `DATOS DEL PERIODO ${meta.start_iso} a ${meta.end_iso} (${meta.hours}h):

- Alertas criticas (entradas a estado anormal): ${alerts.transitions_to_abnormal}
- Saltos abruptos detectados: ${alerts.jumps_total}
- Sensores que estuvieron fuera de rango: ${out.length ? out.join('; ') : 'ninguno — todo en rango'}

INSTRUCCIONES:
Redacta el RESUMEN EJECUTIVO. 1 a 2 parrafos cortos (maximo 120 palabras). Comienza
directo con la informacion — NO escribas "Resumen ejecutivo:". Menciona: cuantas
alertas hubo, si hubo sensores persistentemente fuera de rango y cuales, y el estado
general (saludable / requiere atencion / critico).`;
}

function promptEvents(data) {
  const { alerts } = data;
  const tx = (alerts.transitions || []).slice(-10)
    .filter((t) => typeof t.value === 'number')
    .map((t) => `- ${t.ts_iso} ${t.var}: ${t.transition} (valor ${t.value})`)
    .join('\n') || '(sin transiciones)';
  const jumps = (alerts.jumps || []).slice(-10)
    .map((j) => `- ${j.ts_iso} ${j.var}: ${j.from_value} -> ${j.to_value}`)
    .join('\n') || '(sin saltos)';
  return `DATOS DE EVENTOS:

Transiciones por sensor: ${JSON.stringify(alerts.transitions_by_var || {})}

Ultimas transiciones:
${tx}

Saltos abruptos:
${jumps}

INSTRUCCIONES:
Redacta la seccion "EVENTOS DESTACADOS". 2 a 3 parrafos. Si NO hubo eventos
significativos, dilo en 1 parrafo y termina. Si hubo: identifica el sensor mas
afectado y el patron; si hay saltos, sugiere causas plausibles (ventilacion, puerta
abierta, intervencion manual) en tono especulativo; conecta con horas del dia si
aplica. NO inventes causas — solo posibilidades.`;
}

function promptWeekly(data) {
  const wt = ((data.aggregations || {}).TEMP || {}).weekly || [];
  const wh = ((data.aggregations || {}).HUM || {}).weekly || [];
  const fmt = (weeks, unit) => weeks.map((w) => {
    const wk = w.week.split('-W').pop();
    const tag = w.is_best ? ' (MEJOR)' : (w.is_worst ? ' (PEOR)' : '');
    return `  Semana ${wk}: promedio ${w.avg}${unit}, ${w.in_range_pct}% del tiempo en rango${tag}`;
  }).join('\n');
  return `DATOS POR SEMANA:

Temperatura:
${fmt(wt, '°C')}

Humedad:
${fmt(wh, '%')}

INSTRUCCIONES:
Redacta "COMPARATIVA SEMANAL" en 1-2 parrafos cortos y sencillos: cual fue la mejor
semana y cual necesito mas atencion (y por que), si hubo una tendencia, y que semana
vigilar mas de cerca. Habla para alguien no tecnico.`;
}

function promptRecommendations(data) {
  const { alerts } = data;
  const outT = outOfRangeList(data.history.TEMP, 'TEMP', '°C').filter((_, i) => true);
  const outH = outOfRangeList(data.history.HUM, 'HUM', '%');
  return `DATOS:

- Alertas criticas totales: ${alerts.transitions_to_abnormal}
- Saltos abruptos: ${alerts.jumps_total}
- Sensores de temperatura fuera de rango: ${outT.length ? outT.join('; ') : 'ninguno'}
- Sensores de humedad fuera de rango: ${outH.length ? outH.join('; ') : 'ninguno'}
- Transiciones por sensor: ${JSON.stringify(alerts.transitions_by_var || {})}

INSTRUCCIONES:
Redacta entre 3 y 5 recomendaciones accionables como **lista con guiones** (cada item
maximo 1 linea). Prioriza: sensores persistentemente fuera de rango (revisar
humidificacion, ventilacion, calefaccion), patrones repetidos (mismo sensor con muchas
transiciones = revisar calibracion o ubicacion). Si todo esta OK, sugiere mantener
calibracion rutinaria y monitoreo. NO incluyas disclaimer — el template ya lo añade.`;
}

// ---------- fallbacks estaticos ----------

function fallbackSummary(data) {
  const a = data.alerts;
  return `<p>Durante el periodo se registraron <strong>${a.transitions_to_abnormal}</strong> `
    + `alertas criticas y <strong>${a.jumps_total}</strong> saltos abruptos en los sensores. `
    + `Revise las graficas y tablas siguientes para el detalle completo de cada evento.</p>`;
}

function fallbackEvents(data) {
  const n = data.alerts.transitions_total;
  if (!n) return '<p>No se registraron cambios de estado en el periodo — el complejo se mantuvo estable.</p>';
  return `<p>Se detectaron ${n} cambios de estado. Consulte la cronologia a continuacion para el detalle.</p>`;
}

function fallbackWeekly(data) {
  const weekly = ((data.aggregations || {}).TEMP || {}).weekly || [];
  const best = weekly.find((w) => w.is_best);
  const worst = weekly.find((w) => w.is_worst);
  const parts = [];
  if (best) parts.push(`La semana ${best.week.split('-W').pop()} fue la mas estable (${best.in_range_pct}% del tiempo en rango).`);
  if (worst) parts.push(`La semana ${worst.week.split('-W').pop()} necesito mas atencion (${worst.in_range_pct}%).`);
  return parts.length ? `<p>${parts.join(' ')}</p>` : '<p>Comparativa semanal disponible en las graficas.</p>';
}

function fallbackRecommendations() {
  return '<ul>'
    + '<li>Verifique las lecturas con inspeccion visual del complejo.</li>'
    + '<li>Mantenga calibracion rutinaria de los sensores.</li>'
    + '<li>Revise humidificacion y ventilacion si hay alertas persistentes.</li>'
    + '</ul>';
}

// ---------- markdown lite -> HTML ----------

export function markdownToHtml(md) {
  let s = md.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*([^*]|$)/g, '$1<em>$2</em>$3');

  const lines = s.split('\n');
  const out = [];
  let listItems = [];
  let para = [];
  const flushPara = () => {
    if (para.length) {
      const text = para.map((l) => l.trim()).join(' ').trim();
      if (text) out.push(`<p>${text}</p>`);
      para = [];
    }
  };
  const flushList = () => {
    if (listItems.length) {
      out.push('<ul>' + listItems.map((it) => `<li>${it}</li>`).join('') + '</ul>');
      listItems = [];
    }
  };
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('- ') || t.startsWith('• ')) {
      flushPara();
      listItems.push(t.slice(2).trim());
    } else if (!t) {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return out.join('\n');
}
