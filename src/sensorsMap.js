// UNICO archivo donde se definen las zonas, sensores fisicos y su mapeo a
// variables Ubidots.
//   ZONES         = unidades logicas que se agrupan en el sidebar.
//   SENSORS       = puntos fisicos de medicion. Cada uno tiene zona, tunel
//                   y un par (tempVariable, humVariable) opcionales.
//   displayLabels = etiquetas FIJAS en el render 3D (no cambian con tab):
//                   una por cada {mode, label, yOffset} en el array.
//
// El campo `sidebarLabel` define el texto que se muestra en el panel lateral
// (puede ser distinto del displayLabel del render).

import { UBIDOTS_DEVICE } from './config.js';

export const DEVICE = UBIDOTS_DEVICE;

export const ZONES = [
  { id: 'engorda',     label: 'Engorda',     tunnels: ['eng1', 'eng2'] },
  { id: 'desarrollo',  label: 'Desarrollo',  tunnels: ['dev'] },
  { id: 'hab1',        label: 'Habita 1',    tunnels: ['hab1'] },
  { id: 'hab2',        label: 'Habita 2',    tunnels: ['hab2'] },
];

export const SENSORS = [
  // === Engorda ===
  // sith3 = entre ambos tuneles (X centro de eng1/eng2 = -9), Z=0 (centro).
  // Lo asignamos al tunnel eng1 para que el heatmap volumetrico de eng1 use
  // este sensor como su extremo sur.
  { id: 'eng_c', zone: 'engorda', tunnel: 'eng1',
    sidebarLabel: 'ENG·C',
    tempVariable: 'sith3_temperature', humVariable: 'sith3_humidity',
    coords3D: { x: -9.1, y: 1.5, z: 0 },
    displayLabels: [
      // Etiqueta colocada cerca del piso (yOffset negativo): el panel queda
      // a ~0.8 m de altura, claramente arriba del piso pero por debajo de la
      // mirada — no obstruye la vista volumetrica del heatmap.
      { mode: 'temp', label: 'ENGT-C', yOffset: -0.7 },
      { mode: 'hum',  label: 'ENGH-C', yOffset: -0.7 },
    ] },
  // sfth3 = pegado a la pared del cajon sanitario (hastial norte del eng1).
  // Z cercana a -halfL (=-10), centro X de eng1 = -13.5.
  { id: 'eng_n', zone: 'engorda', tunnel: 'eng1',
    sidebarLabel: 'ENG·N',
    tempVariable: 'sfth3_temperature', humVariable: 'sfth3_humidity',
    coords3D: { x: -13.5, y: 1.5, z: -8.5 },
    displayLabels: [
      { mode: 'temp', label: 'ENGT-N', yOffset: 1.7 },
      { mode: 'hum',  label: 'ENGH-N', yOffset: 1.7 },
    ] },
  // sfth4 = pegado a la pared de Desarrollo (pared derecha de eng2), centro Z=0.
  // Pared derecha de eng2: X = eng2_CX + halfW = -4.5 + 4.5 = 0. Sensor a X=-0.15
  // (apenas dentro de eng2). y=1.5 (mitad de la pared).
  { id: 'eng_d', zone: 'engorda', tunnel: 'eng2',
    sidebarLabel: 'ENG·D',
    tempVariable: 'sfth4_temperature', humVariable: 'sfth4_humidity',
    coords3D: { x: -0.15, y: 1.5, z: 0 },
    // wallNormal: el panel queda pegado a la pared X=0 (linde eng2/desarrollo)
    // mirando hacia el interior de Engorda 2 (-X). Sin billboard, no gira.
    wallNormal: { x: -1, y: 0, z: 0 },
    displayLabels: [
      { mode: 'temp', label: 'ENGT-D', yOffset: 0 },
      { mode: 'hum',  label: 'ENGH-D', yOffset: 0 },
    ] },

  // === Desarrollo ===
  // Sensor central pegado a la pared izquierda del tunel Desarrollo (la que
  // linda con Engorda 2). Eje X = dev_CX - halfW = 4.5 - 4.5 = 0.
  // y=0.9 (mitad de la pared vertical, wallH=1.8) y yOffset chico (0.55) para
  // que la etiqueta quede dentro del arco — cerca de la pared el techo baja
  // mucho por la curvatura del domo.
  { id: 'dev_c', zone: 'desarrollo', tunnel: 'dev',
    sidebarLabel: 'DEV·C',
    tempVariable: 'sico2_temperature', humVariable: 'sico2_humidity',
    coords3D: { x: 0.15, y: 0.9, z: 0 },
    // wallNormal: el panel queda pegado a la pared X=0 (linde eng2/desarrollo)
    // mirando hacia el interior de Desarrollo (+X). Sin billboard, no gira.
    wallNormal: { x: 1, y: 0, z: 0 },
    displayLabels: [
      { mode: 'temp', label: 'DEV-T', yOffset: 0 },
      { mode: 'hum',  label: 'DEV-H', yOffset: 0 },
    ] },

  // === Habita 1 ===
  { id: 'hab1_n', zone: 'hab1', tunnel: 'hab1',
    sidebarLabel: 'HAB1·N',
    tempVariable: 'sith5_temperature', humVariable: 'sith5_humidity',
    coords3D: { x: 4.5, y: 1.0, z: -7.0 },
    displayLabels: [
      { mode: 'temp', label: 'HBT-N', yOffset: 1.7 },
      { mode: 'hum',  label: 'HBH-N', yOffset: 1.7 },
    ] },
  { id: 'hab1_s', zone: 'hab1', tunnel: 'hab1',
    sidebarLabel: 'HAB1·S',
    tempVariable: 'sfth2_temperature', humVariable: 'sfth2_humidity',
    coords3D: { x: 4.5, y: 1.0, z: -2.2 },
    displayLabels: [
      { mode: 'temp', label: 'HBT-S', yOffset: 1.7 },
      { mode: 'hum',  label: 'HBH-S', yOffset: 1.7 },
    ] },

  // === Habita 2 ===
  { id: 'hab2_n', zone: 'hab2', tunnel: 'hab2',
    sidebarLabel: 'HAB2·N',
    tempVariable: 'sfth1_temperature', humVariable: 'sfth1_humidity',
    coords3D: { x: 4.5, y: 1.0, z: 2.1 },
    displayLabels: [
      { mode: 'temp', label: 'HBT-N', yOffset: 1.7 },
      { mode: 'hum',  label: 'HBH-N', yOffset: 1.7 },
    ] },
  { id: 'hab2_s', zone: 'hab2', tunnel: 'hab2',
    sidebarLabel: 'HAB2·S',
    tempVariable: 'sith4_temperature', humVariable: 'sith4_humidity',
    coords3D: { x: 4.5, y: 1.0, z: 7.1 },
    displayLabels: [
      { mode: 'temp', label: 'HBT-S', yOffset: 1.7 },
      { mode: 'hum',  label: 'HBH-S', yOffset: 1.7 },
    ] },
];

// Capacidad de sensores por zona precalculada (SENSORS es estatico).
// Evita O(n²) en getAll() del SnapshotStore que se llama en cada mensaje MQTT.
export const ZONE_CAPACITY = Object.fromEntries(
  ZONES.map((z) => [
    z.id,
    {
      temp: SENSORS.filter((s) => s.zone === z.id && s.tempVariable).length,
      hum:  SENSORS.filter((s) => s.zone === z.id && s.humVariable).length,
    },
  ])
);

export const VALID_KEYS = new Set(
  SENSORS.flatMap((s) =>
    [s.tempVariable, s.humVariable]
      .filter(Boolean)
      .map((v) => `${DEVICE}/${v}`)
  ),
);

export function resolveVariable(variable) {
  for (const s of SENSORS) {
    if (s.tempVariable === variable) return { sensor: s, mode: 'temp' };
    if (s.humVariable === variable) return { sensor: s, mode: 'hum' };
  }
  return null;
}

export const ALL_VARIABLES = Array.from(
  new Set(SENSORS.flatMap((s) => [s.tempVariable, s.humVariable].filter(Boolean))),
);

export function sensorsInZone(zoneId) {
  return SENSORS.filter((s) => s.zone === zoneId);
}
