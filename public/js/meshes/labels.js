// Etiquetas 3D con DynamicTexture, fondo redondeado, sombra y linea acento azul.
// Por default usan BILLBOARDMODE_ALL (siempre miran al usuario). Si se pasa
// `wallNormal` (vector normal de la pared apuntando hacia el observador), el
// plano se ancla a la pared sin billboard — util para identificadores de zona.
//
// El dibujo se hace 100% con ctx 2D (Y hacia abajo) y la textura se sube con
// tex.update() — invertY=true por default. Babylon flipea Y al subir a GPU
// y el texto queda derecho en el plano.

const { DynamicTexture, MeshBuilder, StandardMaterial, Vector3 } = BABYLON;

export function makeLabel(scene, line1, line2, pos, planeW = 11.5, planeH = 3.2, wallNormal = null) {
  const tw = 1300, th = line2 ? 320 : 200;
  const tex = new DynamicTexture(`tx_${line1}`,
    { width: tw, height: th }, scene, false);
  tex.hasAlpha = true;

  const ctx = tex.getContext();
  ctx.clearRect(0, 0, tw, th);

  // --- Fondo redondeado ---
  ctx.font = 'bold 92px "Segoe UI", sans-serif';
  const line1W = ctx.measureText(line1).width;
  ctx.font = 'bold 50px "Segoe UI", sans-serif';
  const line2W = ctx.measureText(line2 || '').width;
  const measured = Math.max(line1W, line2W);
  const mw = Math.min(tw - 24, measured + 140);

  const bgH = line2 ? 286 : 156;
  const bgY = line2 ? 18 : (th - bgH) / 2;

  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 24;
  ctx.fillStyle = 'rgba(8,16,34,0.94)';
  ctx.beginPath();
  ctx.roundRect(tw / 2 - mw / 2, bgY, mw, bgH, 18);
  ctx.fill();
  ctx.shadowBlur = 0;

  // --- Linea acento azul (solo si hay subtitulo) ---
  if (line2) {
    ctx.fillStyle = '#4a9fd4';
    ctx.fillRect(tw / 2 - mw / 2 + 24, 188, mw - 48, 6);
  }

  // --- Texto con contorno para legibilidad ---
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  const drawStroked = (text, x, y, color, fontSize) => {
    ctx.font = `bold ${fontSize}px "Segoe UI", sans-serif`;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 6;
    ctx.lineJoin = 'round';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  };

  if (line2) {
    drawStroked(line1, tw / 2, 148, '#ffffff', 72);
    drawStroked(line2, tw / 2, 270, 'rgba(255,255,255,0.85)', 50);
  } else {
    // Etiqueta de una sola linea: titulo mas grande, centrado vertical.
    drawStroked(line1, tw / 2, bgY + bgH * 0.72, '#ffffff', 96);
  }

  tex.update();

  const plane = MeshBuilder.CreatePlane(`pl_${line1}`,
    { width: planeW, height: planeH }, scene);
  plane.position = pos.clone();

  if (wallNormal) {
    // Plano anclado a una pared: orientado segun la normal, sin billboard.
    // Convencion LHS Babylon: atan2(-n.x, -n.z) alinea el frente del plano
    // con n para todas las orientaciones (incluyendo norte/sur). Negar ambos
    // componentes evita el espejo en paredes con n.z != 0.
    const n = wallNormal;
    plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_NONE;
    plane.rotation.y = Math.atan2(-n.x, -n.z);
    // Pequeño offset en la normal para evitar z-fighting con la pared.
    plane.position.x += n.x * 0.06;
    plane.position.z += n.z * 0.06;
  } else {
    plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
  }

  const mat = new StandardMaterial(`lm_${line1}`, scene);
  mat.diffuseTexture = tex;
  mat.emissiveTexture = tex;
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  mat.useAlphaFromDiffuseTexture = true;
  plane.material = mat;
  plane.isPickable = false;

  return plane;
}

// Construye las etiquetas estandar del complejo:
//   - Engorda: flotante (billboard) sobre el centro de los 2 tuneles de engorda
//   - Desarrollo: flotante (billboard) sobre el centro del tunel Desarrollo
//   - Habita 1 / Habita 2: ancladas a la pared frontal de cada habita
//   - Cajón sanitario: etiqueta flotante con subtitulo
export function buildSiteLabels(scene, layout) {
  const {
    eng1CX, eng2CX, devCX, wallH, domeH,
    habSide, habWallH, hab1CZ, hab2CZ,
  } = layout;

  const engorda_CX = (eng1CX + eng2CX) / 2;
  const wallNormalFront = { x: 0, y: 0, z: -1 };

  const yHab = habWallH * 0.58;
  const topH = wallH + domeH; // techo del tunel

  return [
    // Engorda — flotante billboard sobre el centro de los 2 tuneles
    makeLabel(scene, 'Engorda', null,
      new Vector3(engorda_CX, topH + 1.8, 0), 6.5, 1.6),

    // Desarrollo — flotante billboard sobre el centro del tunel Desarrollo
    makeLabel(scene, 'Desarrollo', null,
      new Vector3(devCX, topH + 1.8, 0), 6.5, 1.6),

    // Pared sur de Habita 1 (dentro del tunel Desarrollo, traslucido)
    makeLabel(scene, 'Habita 1', null,
      new Vector3(devCX, yHab, hab1CZ - habSide / 2), 3.6, 0.9, wallNormalFront),

    // Pared sur de Habita 2
    makeLabel(scene, 'Habita 2', null,
      new Vector3(devCX, yHab, hab2CZ - habSide / 2), 3.6, 0.9, wallNormalFront),

    // Cajón sanitario — flotante billboard justo arriba del techo del cajón.
    // El cajón vive en (eng1CX, 0..wallH, -tunnelL/2-1) con techo a wallH+0.04.
    makeLabel(scene, 'Cajón sanitario', 'Acceso controlado',
      new Vector3(eng1CX, wallH + 1.6, -11), 5.5, 1.8),
  ];
}
