// Colorbar horizontal overlay sobre el render. Pinta la paleta del modo activo
// como CSS linear-gradient y muestra 5 etiquetas equiespaciadas (min, q1, mid,
// q3, max). Se actualiza al cambiar de modo o si cambian los rangos.

import {
    TEMP_COLORSCALE, HUMIDITY_COLORSCALE, colorscaleToGradient, getRange,
} from './colorScales.js';

const $bar = document.getElementById('colorbar-h-bar');
const $scale = document.getElementById('colorbar-h-scale');
const $title = document.getElementById('colorbar-h-title');

export function setMode(mode) {
    // Fade out → actualizar → fade in
    [$title, $bar, $scale].forEach((el) => { if (el) el.style.opacity = '0'; });

    setTimeout(() => {
        const scale = mode === 'temp' ? TEMP_COLORSCALE : HUMIDITY_COLORSCALE;
        const range = getRange(mode);
        const unit = mode === 'temp' ? '°C' : '%';

        $bar.style.background = colorscaleToGradient(scale, 'to right');

        if ($title) {
            $title.textContent = mode === 'temp' ? `TEMPERATURA (${unit})` : `HUMEDAD (${unit})`;
        }

        const span = range.max - range.min;
        const labels = [0, 0.25, 0.5, 0.75, 1].map((t) => {
            const v = range.min + span * t;
            return Number.isInteger(v) ? `${v}${unit}` : `${v.toFixed(1)}${unit}`;
        });
        $scale.innerHTML = labels.map((l) => `<span>${l}</span>`).join('');

        requestAnimationFrame(() => {
            [$title, $bar, $scale].forEach((el) => { if (el) el.style.opacity = '1'; });
        });
    }, 200);
}
