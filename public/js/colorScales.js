// Paletas portadas directamente de tenebrios-node/public/js/colorScales.js.
// Los rangos numericos vienen de /api/config (configurables en src/config.js
// del backend: TEMP_MIN, TEMP_MAX, HUM_MIN, HUM_MAX). Los stops del colorscale
// son [0..1] y el mapeo a [vmin..vmax] se hace por interpolacion lineal.

// Temperatura: azul (frio) -> verde (templado) -> rojo (caliente).
export const TEMP_COLORSCALE = [
    [0,    'rgb(0,0,200)'],
    [0.1,  'rgb(0,80,255)'],
    [0.2,  'rgb(0,180,220)'],
    [0.3,  'rgb(0,210,140)'],
    [0.4,  'rgb(0,200,0)'],
    [0.5,  'rgb(140,220,0)'],
    [0.6,  'rgb(255,220,0)'],
    [0.75, 'rgb(255,140,0)'],
    [0.9,  'rgb(220,40,0)'],
    [1,    'rgb(160,0,0)'],
];

// Humedad: azul fuerte -> azul claro -> verde -> naranja -> rojo.
export const HUMIDITY_COLORSCALE = [
    [0,    'rgb(0,40,220)'],
    [0.4,  'rgb(0,200,255)'],
    [0.6,  'rgb(0,200,100)'],
    [0.7,  'rgb(0,220,0)'],
    [0.8,  'rgb(0,200,0)'],
    [0.9,  'rgb(220,160,0)'],
    [1,    'rgb(220,40,0)'],
];

// Rangos en vivo — los setea app.js leyendo /api/config.ranges.
let TEMP_RANGE = { min: 10, max: 45 };
let HUM_RANGE = { min: 0, max: 100 };

export function setRanges(ranges) {
    if (ranges?.temp) TEMP_RANGE = ranges.temp;
    if (ranges?.hum) HUM_RANGE = ranges.hum;
}

export function getRange(mode) {
    return mode === 'temp' ? TEMP_RANGE : HUM_RANGE;
}

/** Interpola un color a lo largo de un colorscale en t normalizado [0,1]. */
export function interpolateColorscale(colorscale, t) {
    t = Math.max(0, Math.min(1, t));
    let i = 0;
    for (; i < colorscale.length - 1; i++) {
        if (t <= colorscale[i + 1][0]) break;
    }
    const [t0, c0] = colorscale[i];
    const [t1, c1] = colorscale[Math.min(i + 1, colorscale.length - 1)];
    const p = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
    const parse = (s) => s.match(/\d+/g).map(Number);
    const [r0, g0, b0] = parse(c0);
    const [r1, g1, b1] = parse(c1);
    const r = Math.round(r0 + p * (r1 - r0));
    const g = Math.round(g0 + p * (g1 - g0));
    const b = Math.round(b0 + p * (b1 - b0));
    return `rgb(${r},${g},${b})`;
}

/** Devuelve [r,g,b] floats 0..1 (util para BABYLON.Color3). */
export function rgbToColor3(rgbStr) {
    const [r, g, b] = rgbStr.match(/\d+/g).map(Number);
    return [r / 255, g / 255, b / 255];
}

export function tempColor(value) {
    const t = (value - TEMP_RANGE.min) / (TEMP_RANGE.max - TEMP_RANGE.min);
    return interpolateColorscale(TEMP_COLORSCALE, t);
}

export function humidityColor(value) {
    const t = (value - HUM_RANGE.min) / (HUM_RANGE.max - HUM_RANGE.min);
    return interpolateColorscale(HUMIDITY_COLORSCALE, t);
}

/** Helper genérico: pasa value y mode ('temp'|'hum') y devuelve un HEX. */
export function colorForValue(value, mode) {
    if (value === null || value === undefined || !Number.isFinite(value)) return '#3a5060';
    const rgb = mode === 'temp' ? tempColor(value) : humidityColor(value);
    const [r, g, b] = rgb.match(/\d+/g).map(Number);
    return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}

/** Devuelve un CSS linear-gradient horizontal que reproduce la colorscale. */
export function colorscaleToGradient(colorscale, direction = 'to right') {
    const stops = colorscale.map(([t, c]) => `${c} ${(t * 100).toFixed(0)}%`).join(', ');
    return `linear-gradient(${direction}, ${stops})`;
}
