// Orquestador del frontend: arranca Babylon, abre SSE, distribuye datos a las
// cards y a la escena, maneja tabs Temp/Hum y modo inmersion.

console.log('%cMALINALCO frontend build 2026-05-14',
  'color:#E8B830;font-weight:bold;background:#1a2630;padding:4px 8px;');

import {
  initScene, prepareHeatVolume,
  applySnapshot as sceneApplySnapshot, setMode as sceneSetMode,
  setAlertRanges as sceneSetAlertRanges,
} from './scene.js';
import { setRanges } from './colorScales.js';
import {
  setZones, setSensors, setThresholds, setAlertRanges,
  applySnapshot as cardsApplySnapshot,
} from './cards.js';
import { setMode as colorbarSetMode } from './colorbar.js';
import { initImmersion } from './immersion.js';

let snapshot = null;
let mode = 'temp';

// Edad maxima en minutos antes de marcar el dato como amber/red.
// Se sobrescriben con los valores de /api/config (thresholds.warnMin/errorMin).
let warnMin = 5;
let errorMin = 30;
let lastTs = null; // timestamp ms del ultimo dato recibido

window.addEventListener('DOMContentLoaded', async () => {
  initScene(document.getElementById('scene3d-canvas'));
  initImmersion();
  setupModeButtons();

  // /api/config primero: zonas (sidebar) + sensores fisicos (etiquetas 3D).
  try {
    const cfg = await (await fetch('/api/config')).json();
    setZones(cfg.zones);
    setSensors(cfg.sensors);
    setRanges(cfg.ranges);
    setThresholds(cfg.thresholds);
    if (cfg.alertRanges) {
      setAlertRanges(cfg.alertRanges);
      sceneSetAlertRanges(cfg.alertRanges);
    }
    if (cfg.thresholds) {
      if (Number.isFinite(cfg.thresholds.warnMin)) warnMin = cfg.thresholds.warnMin;
      if (Number.isFinite(cfg.thresholds.errorMin)) errorMin = cfg.thresholds.errorMin;
    }
    colorbarSetMode(mode);
    prepareHeatVolume(cfg.sensors);
  } catch (e) {
    console.error('Error cargando /api/config:', e);
    setStatus('err', 'Error de configuracion');
    return;
  }

  // Hidratacion inicial con snapshot completo.
  try {
    const data = await (await fetch('/api/data')).json();
    snapshot = data;
    cardsApplySnapshot(data);
    sceneApplySnapshot(data, mode);
    updateTimestamp(data.lastUpdate);
  } catch (e) {
    console.warn('Error cargando /api/data:', e);
  }

  connectStream();

  // Refresca el "hace X tiempo" cada 15s para que la antigüedad sea visible
  // aunque no lleguen mensajes nuevos.
  setInterval(refreshAge, 15000);
});

function setupModeButtons() {
  document.querySelectorAll('.mode-toggle button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.mode;
      if (next === mode) return;
      mode = next;
      document.querySelectorAll('.mode-toggle button').forEach((b) =>
        b.classList.toggle('active', b.dataset.mode === mode));
      // Las tabs solo afectan al render 3D (heatmap + etiquetas) y la colorbar.
      // El sidebar muestra Temp + Hum simultaneamente y NO cambia con las tabs.
      sceneSetMode(mode);
      colorbarSetMode(mode);
    });
  });
}

function connectStream() {
  const es = new EventSource('/api/stream');

  es.addEventListener('open', () => setStatus('ok', 'Conectado'));

  // El backend emite un 'snapshot' completo al conectar y tambien en cada
  // cambio (despues del evento 'data' individual). El frontend usa 'snapshot'
  // como fuente unica de verdad — sin matematica local de promedios.
  es.addEventListener('snapshot', (e) => {
    snapshot = JSON.parse(e.data);
    cardsApplySnapshot(snapshot);
    sceneApplySnapshot(snapshot, mode);
    updateTimestamp(snapshot.lastUpdate);
  });

  // 'data' es solo informativo (timestamp del cambio para el header).
  es.addEventListener('data', (e) => {
    const change = JSON.parse(e.data);
    updateTimestamp(change.ts);
  });

  es.addEventListener('error', () => {
    setStatus('err', 'Reconectando...');
    if (es.readyState === EventSource.CLOSED) {
      setTimeout(connectStream, 3000);
    }
  });
}

function setStatus(cls, text) {
  const $dot = document.getElementById('conn-dot');
  const $txt = document.getElementById('conn-status');
  if ($dot) $dot.className = `connection-dot ${cls}`;
  if ($txt) $txt.textContent = text;
}

function updateTimestamp(ts) {
  const $ts = document.getElementById('mqtt-timestamp');
  if (!$ts || !ts) return;
  lastTs = ts;
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  // Fecha + hora local, formato YYYY-MM-DD HH:MM:SS
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  $ts.textContent = `${date} ${time}`;
  refreshAge();
}

// Calcula "hace X tiempo" desde lastTs y aplica clase de antigüedad al header.
function refreshAge() {
  const $age = document.getElementById('mqtt-age');
  const $hc  = document.querySelector('.header-center');
  if (!$age || !$hc || !lastTs) return;

  const diffMs = Date.now() - lastTs;
  $age.textContent = formatAge(diffMs);

  const diffMin = diffMs / 60000;
  $hc.classList.remove('age-fresh', 'age-warn', 'age-err');
  if (diffMin >= errorMin)       $hc.classList.add('age-err');
  else if (diffMin >= warnMin)   $hc.classList.add('age-warn');
  else                           $hc.classList.add('age-fresh');
}

function formatAge(ms) {
  if (ms < 0) return 'hace un instante';
  const s = Math.floor(ms / 1000);
  if (s < 60)         return `hace ${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60)         return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24)         return `hace ${h} h ${m % 60} min`;
  const d = Math.floor(h / 24);
  return `hace ${d} d ${h % 24} h`;
}
