// Etiquetas flotantes sobre cada sensor en el render. Dos modos:
//
//   1) Sensor SIN `displayLabels`: una sola etiqueta que cambia con la tab
//      Temp/Hum (comportamiento original, muestra el `sensor.label`).
//
//   2) Sensor CON `displayLabels`: una etiqueta FIJA por cada entrada del array,
//      con su propia magnitud y posicion vertical (yOffset). No cambian con tabs.
//      Util para habitas: ver temp y hum simultaneamente (HBT-N, HBH-N, HBT-S, HBH-S).
//
// Cuando el valor sale del rango ideal, el recuadro PARPADEA con un borde
// grueso de color (cyan si bajo, rojo si alto) — controlado por _blinkOn.

const { MeshBuilder, StandardMaterial, DynamicTexture, Vector3 } = BABYLON;

// Tamano del plano en el mundo 3D y resolucion de su textura.
const PLANE_W = 4.4;
const PLANE_H = 1.15;
const TEX_W = 1000;
const TEX_H = 290;

const _labels = [];

let _alertRanges = null;
let _blinkOn = true;

export function setAlertRanges(ar) {
    _alertRanges = ar;
}

function alertStateFor(value, mode) {
    if (value === null || value === undefined || !_alertRanges) return null;
    const ar = _alertRanges[mode];
    if (!ar) return null;
    if (value < ar.low) return 'low';
    if (value > ar.high) return 'high';
    return null;
}

export function buildSensorLabels(scene, sensorsMeta) {
    for (const l of _labels) {
        l.plane.dispose(); l.tex.dispose(); l.mat.dispose();
    }
    _labels.length = 0;

    for (const s of sensorsMeta) {
        if (Array.isArray(s.displayLabels) && s.displayLabels.length) {
            for (let i = 0; i < s.displayLabels.length; i++) {
                const dl = s.displayLabels[i];
                const id = `${s.id}_${dl.mode}_${i}`;
                _labels.push(createLabel(scene, id, s, dl.label, dl.mode, dl.yOffset ?? 1.8));
            }
        } else {
            _labels.push(createLabel(scene, s.id, s, s.label || s.id, null, 1.8));
        }
    }
}

function createLabel(scene, id, sensor, labelText, fixedMode, yOffset) {
    const tex = new DynamicTexture(`slbl_${id}`,
        { width: TEX_W, height: TEX_H }, scene, false);
    tex.hasAlpha = true;

    const mat = new StandardMaterial(`slblMat_${id}`, scene);
    mat.diffuseTexture = tex;
    mat.emissiveTexture = tex;
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    mat.useAlphaFromDiffuseTexture = true;

    const plane = MeshBuilder.CreatePlane(`slblPlane_${id}`,
        { width: PLANE_W, height: PLANE_H }, scene);
    plane.position = new Vector3(
        sensor.coords3D.x,
        sensor.coords3D.y + yOffset,
        sensor.coords3D.z,
    );

    // Si el sensor define `wallNormal`, la etiqueta queda fija a la pared con
    // la rotacion alineada con esa normal (sin billboard). Util para sensores
    // montados sobre paredes verticales — el panel actua como placa.
    if (sensor.wallNormal) {
        const n = sensor.wallNormal;
        plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_NONE;
        // Babylon LHS: para alinear el frente del plano con la normal `n` se
        // usa atan2(-n.x, -n.z). Negar ambos componentes evita el espejo cuando
        // la pared es norte/sur (n.z != 0); cuando n.z = 0 (paredes este/oeste)
        // el resultado coincide con la convencion anterior.
        plane.rotation.y = Math.atan2(-n.x, -n.z);
        // Ligero desplazamiento sobre la normal para evitar z-fighting con la
        // geometria de la pared.
        plane.position.x += n.x * 0.1;
        plane.position.z += n.z * 0.1;
    } else {
        plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    }

    plane.material = mat;
    plane.isPickable = false;

    // Ancho del fondo: el mas grande entre el label y el peor caso del valor
    // (e.g. "100.0 °C"), fijo durante toda la vida de la etiqueta para evitar
    // jitter del recuadro al cambiar valores.
    const ctxTmp = tex.getContext();
    ctxTmp.font = 'bold 76px "Segoe UI", sans-serif';
    const labelW = ctxTmp.measureText(labelText.toUpperCase()).width;
    ctxTmp.font = 'bold 104px "Segoe UI", sans-serif';
    const sampleValue = fixedMode === 'hum' ? '100 %' : '100.0 °C';
    const valueW = ctxTmp.measureText(sampleValue).width;
    const bgWidth = Math.min(TEX_W - 40, Math.max(labelW, valueW) + 96);

    const entry = {
        plane, tex, mat,
        sensorId: sensor.id,
        fixedMode, labelText, bgWidth,
        lastReading: null,
        alertState: null,
    };
    paintLabel(entry, null);
    return entry;
}

function paintLabel(entry, reading) {
    if (reading !== undefined) entry.lastReading = reading;
    const actualReading = entry.lastReading;

    const { tex, labelText, fixedMode, bgWidth } = entry;
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, TEX_W, TEX_H);

    const bgX = TEX_W / 2 - bgWidth / 2;
    const alertState = actualReading ? alertStateFor(actualReading.value, fixedMode) : null;
    entry.alertState = alertState;

    // Fondo redondeado con sombra
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 20;
    ctx.fillStyle = 'rgba(8,16,34,0.96)';
    ctx.beginPath();
    ctx.roundRect(bgX, 18, bgWidth, TEX_H - 36, 18);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Borde grueso de alerta — parpadea (solo se dibuja cuando _blinkOn=true).
    if (alertState && _blinkOn) {
        ctx.lineWidth = 14;
        ctx.strokeStyle = alertState === 'low' ? '#6bdcff' : '#ff5b4f';
        ctx.beginPath();
        ctx.roundRect(bgX + 7, 25, bgWidth - 14, TEX_H - 50, 14);
        ctx.stroke();
    }

    // Linea acento — dorada para temperatura, azul para humedad
    ctx.fillStyle = fixedMode === 'hum' ? '#4a9fd4' : '#E8B830';
    ctx.fillRect(bgX + 18, 142, bgWidth - 36, 5);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    // Stroke + fill para legibilidad sobre fondo de heatmap colorido detras.
    const drawTextStroked = (text, x, y, fillColor) => {
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.lineWidth = 7;
        ctx.lineJoin = 'round';
        ctx.strokeText(text, x, y);
        ctx.fillStyle = fillColor;
        ctx.fillText(text, x, y);
    };

    // Label arriba
    ctx.font = 'bold 76px "Segoe UI", sans-serif';
    drawTextStroked(labelText.toUpperCase(), TEX_W / 2, 115, '#ffffff');

    // Valor abajo
    const value = actualReading?.value;
    const unit = fixedMode === 'hum' ? '%' : '°C';
    const valueText = (value === null || value === undefined)
        ? '--'
        : (fixedMode === 'hum'
            ? `${value.toFixed(0)} ${unit}`
            : `${value.toFixed(1)} ${unit}`);

    ctx.font = 'bold 104px "Segoe UI", sans-serif';
    drawTextStroked(valueText, TEX_W / 2, 252, fixedMode === 'hum' ? '#9ecfee' : '#E8B830');

    // Triangulo de alerta en esquina superior derecha — siempre visible (no
    // parpadea) cuando hay alerta, para que el indicador no desaparezca en la
    // fase off del parpadeo del borde.
    if (alertState) {
        ctx.font = 'bold 58px "Segoe UI", sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        const triColor = alertState === 'low' ? '#6bdcff' : '#ff5b4f';
        ctx.strokeStyle = 'rgba(0,0,0,0.9)';
        ctx.lineWidth = 5;
        ctx.lineJoin = 'round';
        ctx.strokeText('⚠', bgX + bgWidth - 20, 28);
        ctx.fillStyle = triColor;
        ctx.fillText('⚠', bgX + bgWidth - 20, 28);
    }

    tex.update();
}

export function updateSensorLabels(snapshot, tabMode /* , sensorsMeta */) {
    const byId = {};
    for (const z of snapshot.zones) {
        for (const s of z.sensors) byId[s.id] = s;
    }

    for (const entry of _labels) {
        if (entry.fixedMode && entry.fixedMode !== tabMode) {
            entry.plane.isVisible = false;
            continue;
        }
        entry.plane.isVisible = true;
        const mode = entry.fixedMode ?? tabMode;
        const sensorRuntime = byId[entry.sensorId];
        const reading = sensorRuntime?.[mode] ?? null;
        paintLabel(entry, reading);
    }
}

export function setSensorLabelsVisibility(visible) {
    for (const e of _labels) e.plane.isVisible = visible;
}

// === Parpadeo del borde de alerta ===
// Cada 550ms invertimos _blinkOn y repaint SOLO las etiquetas con alertState.
setInterval(() => {
    _blinkOn = !_blinkOn;
    for (const entry of _labels) {
        if (entry.alertState) paintLabel(entry, undefined);
    }
}, 550);
