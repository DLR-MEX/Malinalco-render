// Sidebar: barras horizontales por SENSOR individual, agrupadas por zona.
// Cada barra muestra:
//   - 3 marcas verticales: limite inferior ideal, punto medio (target), limite
//     superior ideal — segun los alertRanges configurados en backend.
//   - Etiqueta de alerta (FRIO/CALIENTE para temp, BAJA/ALTA para humedad)
//     cuando el valor sale del rango ideal.
//   - Borde de color en el valor: cyan si demasiado bajo, rojo si demasiado alto.

import { tempColor, humidityColor, getRange } from './colorScales.js';

let thresholds = { warnMin: 5, errorMin: 30 };
let alertRanges = { temp: { low: 22, high: 32 }, hum: { low: 50, high: 80 } };
let zonesMeta = [];
let sensorsMeta = [];
let currentData = null;

const $tempContainer = document.getElementById('zone-bars-temp');
const $humContainer = document.getElementById('zone-bars-hum');

export function setThresholds(t) { thresholds = t; }
export function setAlertRanges(ar) { alertRanges = ar; }

export function setZones(zones) {
    zonesMeta = zones;
    rebuild();
}

export function setSensors(sensors) {
    sensorsMeta = sensors;
    rebuild();
}

function rebuild() {
    if (!zonesMeta.length || !sensorsMeta.length) return;
    buildSection($tempContainer, 'temp');
    buildSection($humContainer, 'hum');
}

function pctOf(value, range) {
    return Math.max(0, Math.min(100, ((value - range.min) / (range.max - range.min)) * 100));
}

function buildSection(container, mode) {
    container.innerHTML = '';
    const fullRange = getRange(mode);
    const ar = alertRanges[mode];
    const pctLow = pctOf(ar.low, fullRange);
    const pctMid = pctOf((ar.low + ar.high) / 2, fullRange);
    const pctHigh = pctOf(ar.high, fullRange);

    let rowIndex = 0;

    for (const z of zonesMeta) {
        const sensorsInZone = sensorsMeta.filter((s) => s.zone === z.id);
        const withMagnitude = sensorsInZone.filter((s) =>
            mode === 'temp' ? s.tempVariable : s.humVariable
        );

        const header = document.createElement('div');
        header.className = 'zone-group-header';
        header.textContent = z.label;
        container.appendChild(header);

        if (withMagnitude.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'zone-empty';
            empty.textContent = '— sin sensores —';
            container.appendChild(empty);
            continue;
        }

        for (const s of withMagnitude) {
            const dl = s.displayLabels?.find((d) => d.mode === mode);
            const label = dl?.label || s.sidebarLabel || s.label || s.id;

            const row = document.createElement('div');
            row.className = 'hbar-item';
            row.dataset.sensorId = s.id;
            row.dataset.mode = mode;
            row.style.setProperty('--i', rowIndex++);
            row.innerHTML = `
                <div class="hbar-label">
                    ${label}<span class="hbar-alert-tag" data-alert-tag></span>
                </div>
                <div class="hbar-track-wrap">
                    <div class="hbar-track">
                        <div class="hbar-mark" style="left:${pctLow}%"></div>
                        <div class="hbar-mark-mid" style="left:${pctMid}%"></div>
                        <div class="hbar-mark" style="left:${pctHigh}%"></div>
                        <div class="hbar-fill" data-fill></div>
                    </div>
                    <div class="hbar-scale" data-scale>
                        <span>--</span><span>--</span><span>--</span>
                    </div>
                </div>
                <div class="hbar-value-wrap">
                    <div class="hbar-value" data-value>--</div>
                    <div class="hbar-age" data-age></div>
                </div>
            `;
            container.appendChild(row);
        }
    }
    updateScales(container, mode);
}

function updateScales(container, mode) {
    const r = getRange(mode);
    const unit = mode === 'temp' ? '°' : '%';
    const mid = (r.min + r.max) / 2;
    const html = `<span>${r.min}${unit}</span><span>${mid}${unit}</span><span>${r.max}${unit}</span>`;
    container.querySelectorAll('[data-scale]').forEach((el) => {
        el.innerHTML = html;
    });
}

export function applySnapshot(snapshot) {
    currentData = snapshot;
    render(snapshot);
}

function formatValue(v, mode) {
    if (v === null || v === undefined) return '--';
    return mode === 'temp'
        ? `${v.toFixed(1)}<small>°C</small>`
        : `${v.toFixed(1)}<small>%</small>`;
}

function ageMinutes(ts) {
    return ts ? (Date.now() - ts) / 60000 : Infinity;
}

function formatAge(ts) {
    if (!ts) return null;
    const sec = Math.floor((Date.now() - ts) / 1000);
    if (sec < 60) return `hace ${sec}s`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `hace ${min}m`;
    return `hace ${Math.floor(min / 60)}h`;
}

const ALERT_LABELS = {
    temp: { low: 'FRÍO', high: 'CALIENTE' },
    hum:  { low: 'BAJA', high: 'ALTA' },
};

function renderRow(row, reading, mode) {
    const range = getRange(mode);
    const span = range.max - range.min;
    const $value = row.querySelector('[data-value]');
    const $fill  = row.querySelector('[data-fill]');
    const $tag   = row.querySelector('[data-alert-tag]');
    const $age   = row.querySelector('[data-age]');

    // Limpia clases de estado previas
    row.classList.remove('alert-low', 'alert-high', 'alert-stale', 'muted');
    $tag.textContent = '';
    $tag.className = 'hbar-alert-tag';

    if (!reading || reading.value === null) {
        $value.innerHTML = '--';
        $fill.style.width = '0%';
        if ($age) { $age.textContent = 'sin datos'; $age.className = 'hbar-age'; }
        row.classList.add('muted');
        return;
    }

    $value.innerHTML = formatValue(reading.value, mode);
    const pct = Math.max(0, Math.min(100, ((reading.value - range.min) / span) * 100));
    $fill.style.width = pct + '%';
    $fill.style.background = mode === 'temp'
        ? tempColor(reading.value)
        : humidityColor(reading.value);

    // Alerta por valor fuera del rango ideal
    const ar = alertRanges[mode];
    if (reading.value < ar.low) {
        row.classList.add('alert-low');
        $tag.textContent = ALERT_LABELS[mode].low;
        $tag.classList.add('low');
    } else if (reading.value > ar.high) {
        row.classList.add('alert-high');
        $tag.textContent = ALERT_LABELS[mode].high;
        $tag.classList.add('high');
    }

    // Antiguedad de datos
    const ageMin = ageMinutes(reading.ts);
    if (ageMin > thresholds.errorMin) row.classList.add('alert-stale');

    if ($age) {
        const label = formatAge(reading.ts);
        $age.textContent = label ?? '--';
        if (!label || ageMin > thresholds.errorMin) {
            $age.className = 'hbar-age age-stale';
        } else if (ageMin > thresholds.warnMin) {
            $age.className = 'hbar-age age-warn';
        } else {
            $age.className = 'hbar-age';
        }
    }
}

function render(snapshot) {
    const byId = {};
    for (const z of snapshot.zones) {
        for (const s of z.sensors) byId[s.id] = s;
    }
    for (const container of [$tempContainer, $humContainer]) {
        const rows = container.querySelectorAll('.hbar-item');
        for (const row of rows) {
            const sensorId = row.dataset.sensorId;
            const mode = row.dataset.mode;
            const sensor = byId[sensorId];
            const reading = sensor?.[mode] ?? null;
            renderRow(row, reading, mode);
        }
    }
}

setInterval(() => {
    if (currentData) render(currentData);
}, 1000);
