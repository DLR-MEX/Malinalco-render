// Orquestador de la escena Babylon. Configura engine, escena, camara, luces,
// sombras y post-process; arma 3 tuneles adosados + 2 habitas + etiquetas +
// suelos. Valores tomados del prototipo greenhouse_babylon_v10.html.
//
// Expone meshes.{eng1,eng2,dev}.cover para que la Fase 5 (heatmap) pueda
// inyectar DynamicTextures emisivas en cada cubierta.

import { createMaterials } from './meshes/materials.js';
import { buildGround } from './meshes/ground.js';
import { createTunnel } from './meshes/tunnels.js';
import { buildHabitas, HAB_SIDE, HAB_WALL_H, HAB1_CZ, HAB2_CZ } from './meshes/habitas.js';
import { buildSiteLabels } from './meshes/labels.js';
import { buildHeatVolume, updateHeatVolume } from './meshes/heatVolume.js';
import {
  buildSensorLabels, updateSensorLabels,
  setAlertRanges as setSensorLabelsAlertRanges,
} from './meshes/sensorLabels.js';

// Re-export para que app.js pueda configurar los rangos sin importar el modulo
// interno de meshes directamente.
export function setAlertRanges(ar) {
  setSensorLabelsAlertRanges(ar);
  if (_lastSnapshot) updateSensorLabels(_lastSnapshot, _currentMode, _sensorsMeta);
}

const {
  Engine, Scene, Color3, Color4, Vector3,
  ArcRotateCamera, HemisphericLight, DirectionalLight, ShadowGenerator,
  DefaultRenderingPipeline,
} = BABYLON;

// --- Dimensiones del complejo (sincronizadas con sensorsMap.js del backend) ---
const DOME_H = 3.5;
const WALL_H = 1.8;
const TUNNEL_L = 20;
const ENG_W = 9.0;
const DEV_W = 9.0;

const ENG1_CX = -(ENG_W + DEV_W / 2);          // = -13.5
const ENG2_CX = ENG1_CX + ENG_W;               // = -4.5
const DEV_CX  = ENG2_CX + (ENG_W + DEV_W) / 2; // =  4.5

let _engine = null;
let _scene = null;
let _camera = null;
let _meshes = null;
let _ready = false;

export function initScene(canvas) {
  _engine = new Engine(canvas, true, {
    preserveDrawingBuffer: true,
    stencil: true,
    antialias: true,
    adaptToDeviceRatio: true,
  });

  _scene = new Scene(_engine);
  // Fondo azul oscuro (#1a2630) heredado de tenebrios — mejor contraste con
  // los tuneles translucidos y el heatmap volumetrico que el gris claro del v10.
  _scene.clearColor = new Color4(26 / 255, 38 / 255, 48 / 255, 1);

  // --- Camara ArcRotate libre con limites que evitan que el render se pierda
  //     al alejar o al levantar la vista a cenital. Auto-rotacion al estilo
  //     tenebrios: arranca despues de 12s sin interaccion, rota suave en alpha.
  // Target en (-4.5, 1.5, 0): centro real del complejo (X de -18 a +9).
  _camera = new ArcRotateCamera('cam', -Math.PI / 3.8, Math.PI / 3.3, 56,
    new Vector3(-4.5, 1.5, 0), _scene);
  _camera.attachControl(canvas, true);
  // Zoom: rango razonable para no perder de vista el complejo.
  _camera.lowerRadiusLimit = 18;
  _camera.upperRadiusLimit = 90;
  // Beta: bloquear arriba (no ver bajo el piso) y abajo (no aerea perfecta).
  _camera.upperBetaLimit = Math.PI / 2.05;
  _camera.lowerBetaLimit = Math.PI / 8;
  _camera.wheelPrecision = 3;
  _camera.minZ = 0.1;
  _camera.panningSensibility = 1500; // mouse-right pan suave; mas alto = mas lento

  // Auto-rotation behavior: gira sola al ralenti, se pausa al interactuar.
  _camera.useAutoRotationBehavior = true;
  const auto = _camera.autoRotationBehavior;
  auto.idleRotationSpeed = 0.18;     // rad/s — ~10 deg/s, vuelta completa en ~35s
  auto.idleRotationWaitTime = 12000; // 12s sin interaccion antes de arrancar
  auto.idleRotationSpinupTime = 2000;

  // --- Iluminacion ---
  const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), _scene);
  hemi.intensity = 0.42;
  hemi.diffuse = new Color3(0.86, 0.90, 0.98);
  hemi.groundColor = new Color3(0.20, 0.18, 0.14);
  hemi.specular = new Color3(0.04, 0.04, 0.04);

  const sun = new DirectionalLight('sun', new Vector3(-0.8, -2.0, -1.0), _scene);
  sun.intensity = 0.94;
  sun.diffuse = new Color3(1.0, 0.96, 0.88);
  sun.specular = new Color3(0.22, 0.20, 0.16);
  sun.position = new Vector3(30, 50, 25);

  const shadowGen = new ShadowGenerator(2048, sun);
  shadowGen.useBlurExponentialShadowMap = true;
  shadowGen.blurKernel = 52;
  shadowGen.bias = 0.0008;

  // --- Materiales compartidos ---
  const materials = createMaterials(_scene);

  // --- Suelos ---
  buildGround(_scene, materials);

  // --- 3 tuneles adosados ---
  const eng1 = createTunnel(_scene, materials, shadowGen, 'eng1',
    ENG1_CX, 0, ENG_W, DOME_H, WALL_H, TUNNEL_L, 11,
    { hasDoor: true, hasSanitary: true, skipLeftWall: false, skipRightWall: true });

  const eng2 = createTunnel(_scene, materials, shadowGen, 'eng2',
    ENG2_CX, 0, ENG_W, DOME_H, WALL_H, TUNNEL_L, 11,
    { hasDoor: true, hasSanitary: false, skipLeftWall: true, skipRightWall: false });

  const dev = createTunnel(_scene, materials, shadowGen, 'dev',
    DEV_CX, 0, DEV_W, DOME_H, WALL_H, TUNNEL_L, 11,
    { hasDoor: true, hasSanitary: true, skipLeftWall: false, skipRightWall: false });

  // --- Habitas internas en Desarrollo ---
  const habitasData = buildHabitas(_scene, materials, shadowGen, DEV_CX, DEV_W);

  // --- Etiquetas: identificadores anclados a paredes + cajon flotante ---
  buildSiteLabels(_scene, {
    eng1CX: ENG1_CX, eng2CX: ENG2_CX, devCX: DEV_CX,
    wallH: WALL_H, domeH: DOME_H, tunnelL: TUNNEL_L,
    habSide: HAB_SIDE, habWallH: HAB_WALL_H,
    hab1CZ: HAB1_CZ, hab2CZ: HAB2_CZ,
  });

  // --- Post-process: FXAA + contraste + sharpen ---
  const pp = new DefaultRenderingPipeline('pp', true, _scene, [_camera]);
  pp.fxaaEnabled = true;
  pp.samples = 4;
  pp.imageProcessingEnabled = true;
  pp.imageProcessing.contrast = 1.22;
  pp.imageProcessing.exposure = 1.08;
  pp.sharpenEnabled = true;
  pp.sharpen.edgeAmount = 0.30;

  // --- Render loop ---
  _engine.runRenderLoop(() => _scene.render());
  window.addEventListener('resize', () => _engine.resize());

  _meshes = { eng1, eng2, dev, hab1: habitasData.hab1, hab2: habitasData.hab2 };
  _ready = true;
}

export function isReady() { return _ready; }
export function getMeshes() { return _meshes; }

// Construye los slices del heatmap una vez que app.js tiene la metadata de
// sensores (que llega via /api/config). Hasta que se llame esto, el volumen no
// existe; al llamarlo se crean los planos pero invisibles hasta que llegue data.
let _lastSnapshot = null;
let _currentMode = 'temp';
let _sensorsMeta = [];

export function prepareHeatVolume(sensorsMeta) {
  if (!_ready || !_meshes) return;
  _sensorsMeta = sensorsMeta;
  // Regiones con heatmap:
  //   eng1/eng2: normal (22 slices)
  //   dev:       low (12 slices, alpha bajo — 1 solo sensor sico2)
  //   hab1/hab2: high (44 slices — habitas pequenas con mas densidad)
  const regions = [
    _meshes.eng1,
    _meshes.eng2,
    { ..._meshes.dev, heatDensity: 'low' },
    _meshes.hab1,
    _meshes.hab2,
  ];
  buildHeatVolume(_scene, regions, sensorsMeta);
  buildSensorLabels(_scene, sensorsMeta);
  if (_lastSnapshot) {
    updateHeatVolume(_lastSnapshot, _currentMode);
    updateSensorLabels(_lastSnapshot, _currentMode, _sensorsMeta);
  }
}

export function applySnapshot(snapshot, mode) {
  _lastSnapshot = snapshot;
  if (mode) _currentMode = mode;
  updateHeatVolume(snapshot, _currentMode);
  if (_sensorsMeta.length) updateSensorLabels(snapshot, _currentMode, _sensorsMeta);
}

export function setMode(mode) {
  _currentMode = mode;
  if (_lastSnapshot) {
    updateHeatVolume(_lastSnapshot, _currentMode);
    if (_sensorsMeta.length) updateSensorLabels(_lastSnapshot, _currentMode, _sensorsMeta);
  }
}

// Dimensiones expuestas por si modulos posteriores (heatmap) las necesitan.
export const LAYOUT = {
  domeH: DOME_H, wallH: WALL_H, tunnelL: TUNNEL_L,
  engW: ENG_W, devW: DEV_W,
  eng1CX: ENG1_CX, eng2CX: ENG2_CX, devCX: DEV_CX,
};
