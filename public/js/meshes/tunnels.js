// Construye un tunel (Engorda 1, Engorda 2 o Desarrollo) con paredes laterales,
// arcos metalicos, correas longitudinales, cumbrera, cubierta ribbon translucida,
// hastiales con puerta opcional y cajon sanitario opcional, mas solera base.
//
// Geometria portada directamente de greenhouse_babylon_v10.html (createTunnel +
// addSanitaryBox). Retorna referencias nombradas — la cubierta `cover` es la
// que recibira la DynamicTexture del heatmap en la Fase 5.

const { MeshBuilder, Mesh, Vector3 } = BABYLON;

function addSanitaryBox(scene, materials, shadowGen, cx, cz, zSign, tunnelW, wallH, tag) {
  const bW = tunnelW * 0.60, bD = 2.0, bH = wallH;
  const fZ = cz + zSign * bD;

  // Paneles del cajon
  [
    { w: bW,   h: bH, d: 0.06, x: cx,        y: bH / 2, z: cz + zSign * 0.03 },
    { w: bW,   h: bH, d: 0.06, x: cx,        y: bH / 2, z: fZ },
    { w: 0.06, h: bH, d: bD,   x: cx - bW/2, y: bH / 2, z: cz + zSign * (bD/2) },
    { w: 0.06, h: bH, d: bD,   x: cx + bW/2, y: bH / 2, z: cz + zSign * (bD/2) },
  ].forEach((p, i) => {
    const m = MeshBuilder.CreateBox(`sp${i}_${tag}`, { width: p.w, height: p.h, depth: p.d }, scene);
    m.position.set(p.x, p.y, p.z);
    m.material = materials.sanitary;
    shadowGen.addShadowCaster(m);
    m.receiveShadows = true;
  });

  // Techo del cajon
  const rf = MeshBuilder.CreateBox(`srf_${tag}`,
    { width: bW + 0.06, height: 0.07, depth: bD + 0.06 }, scene);
  rf.position.set(cx, bH + 0.035, cz + zSign * (bD/2));
  rf.material = materials.sanitary;
  shadowGen.addShadowCaster(rf);

  // 4 columnas de marco
  [[-1,-1], [-1,1], [1,-1], [1,1]].forEach(([sx, sz], i) => {
    const c2 = MeshBuilder.CreateBox(`sc${i}_${tag}`,
      { width: 0.09, height: bH + 0.08, depth: 0.09 }, scene);
    c2.position.set(cx + sx * bW/2, bH/2, cz + zSign * (sz < 0 ? 0 : bD));
    c2.material = materials.frame;
    shadowGen.addShadowCaster(c2);
  });

  // Puerta del cajon
  const dW = bW * 0.36, dH = bH * 0.86;
  [-1, 1].forEach((s, i) => {
    const j = MeshBuilder.CreateBox(`sj${i}_${tag}`,
      { width: 0.07, height: dH, depth: 0.09 }, scene);
    j.position.set(cx + s * dW/2, dH/2, fZ);
    j.material = materials.frame;
    shadowGen.addShadowCaster(j);
  });
  const ln = MeshBuilder.CreateBox(`sl_${tag}`,
    { width: dW + 0.07, height: 0.07, depth: 0.09 }, scene);
  ln.position.set(cx, dH, fZ);
  ln.material = materials.frame;
  shadowGen.addShadowCaster(ln);

  // Hoja de la puerta entreabierta
  const ang = 0.26;
  const lf = MeshBuilder.CreateBox(`slf_${tag}`,
    { width: dW - 0.05, height: dH - 0.05, depth: 0.04 }, scene);
  lf.position.set(
    cx - dW/2 + 0.02 + Math.cos(ang) * (dW/2 - 0.02),
    dH/2,
    fZ + zSign * Math.sin(ang) * (dW/2 - 0.02),
  );
  lf.rotation.y = zSign * ang;
  lf.material = materials.sanitary;
  shadowGen.addShadowCaster(lf);

  // Manija
  const hd = MeshBuilder.CreateBox(`sh_${tag}`,
    { width: 0.05, height: 0.05, depth: 0.20 }, scene);
  hd.position.set(cx + dW * 0.26, dH * 0.52, fZ + zSign * 0.06);
  hd.material = materials.frame;
  shadowGen.addShadowCaster(hd);

  // Umbral
  const th = MeshBuilder.CreateBox(`st_${tag}`,
    { width: dW + 0.12, height: 0.06, depth: 0.22 }, scene);
  th.position.set(cx, 0.03, fZ + zSign * 0.11);
  th.material = materials.frame;
  th.receiveShadows = true;
}

/**
 * Crea un tunel completo y retorna referencias nombradas a sus partes.
 * - skipLeftWall / skipRightWall: omite la pared lateral compartida con otro tunel adosado.
 * - hasSanitary: anade cajones sanitarios en los extremos con puerta.
 * - hasDoor: anade marco de puerta en los hastiales.
 */
export function createTunnel(scene, materials, shadowGen, name, cx, cz, width, domeH, wallH, length, arcCount,
    { hasDoor = true, hasSanitary = false, skipLeftWall = false, skipRightWall = false } = {}) {

  const halfW = width / 2, halfL = length / 2, arcRes = 30;
  const refs = { name, cx, cz, width, domeH, wallH, length,
                 walls: [], arcs: [], correas: [], doors: [] };

  // Paredes laterales (omitidas si compartidas).
  [[cx - halfW, skipLeftWall], [cx + halfW, skipRightWall]].forEach(([xb, skip], i) => {
    if (skip) return;
    const ws = MeshBuilder.CreateBox(`wS_${name}_${i}`,
      { width: 0.09, height: wallH, depth: length }, scene);
    ws.position.set(xb, wallH/2, cz);
    ws.material = materials.metal;
    shadowGen.addShadowCaster(ws);

    const wp = MeshBuilder.CreateBox(`wP_${name}_${i}`,
      { width: 0.05, height: wallH - 0.02, depth: length - 0.10 }, scene);
    wp.position.set(xb, wallH/2, cz);
    wp.material = materials.wall;
    wp.receiveShadows = true;

    refs.walls.push({ frame: ws, panel: wp });
  });

  // Arcos transversales.
  for (let i = 0; i < arcCount; i++) {
    const zPos = -halfL + (i / (arcCount - 1)) * length;
    const pts = [];
    for (let j = 0; j <= arcRes; j++) {
      const a = Math.PI * j / arcRes;
      pts.push(new Vector3(
        cx + Math.cos(Math.PI - a) * halfW,
        wallH + Math.sin(a) * domeH,
        cz + zPos,
      ));
    }
    const arc = MeshBuilder.CreateTube(`arc_${name}_${i}`,
      { path: pts, radius: 0.065, tessellation: 10, cap: Mesh.CAP_ALL }, scene);
    arc.material = materials.metal;
    shadowGen.addShadowCaster(arc);
    refs.arcs.push(arc);
  }

  // Correas longitudinales (5).
  for (let c = 0; c < 5; c++) {
    const a = Math.PI * (c + 1) / 6;
    const cr = MeshBuilder.CreateTube(`cr_${name}_${c}`, {
      path: [
        new Vector3(cx + Math.cos(Math.PI - a) * halfW, wallH + Math.sin(a) * domeH, cz - halfL),
        new Vector3(cx + Math.cos(Math.PI - a) * halfW, wallH + Math.sin(a) * domeH, cz + halfL),
      ],
      radius: 0.040,
      tessellation: 7,
    }, scene);
    cr.material = materials.metal;
    shadowGen.addShadowCaster(cr);
    refs.correas.push(cr);
  }

  // Cumbrera.
  const cb = MeshBuilder.CreateTube(`cb_${name}`, {
    path: [
      new Vector3(cx, wallH + domeH, cz - halfL),
      new Vector3(cx, wallH + domeH, cz + halfL),
    ],
    radius: 0.052,
    tessellation: 8,
  }, scene);
  cb.material = materials.metal;
  shadowGen.addShadowCaster(cb);
  refs.cumbrera = cb;

  // Cubierta ribbon translucida — la que recibira la DynamicTexture del heatmap.
  const rp = [];
  for (let j = 0; j <= arcRes; j++) {
    const a = Math.PI * j / arcRes;
    rp.push([
      new Vector3(cx + Math.cos(Math.PI - a) * halfW, wallH + Math.sin(a) * domeH, cz - halfL),
      new Vector3(cx + Math.cos(Math.PI - a) * halfW, wallH + Math.sin(a) * domeH, cz + halfL),
    ]);
  }
  // Material clonado por tunel — Fase 5 inyectara una textura distinta en cada uno.
  const coverMat = materials.cover.clone(`cover_${name}`);
  const cov = MeshBuilder.CreateRibbon(`cov_${name}`,
    { pathArray: rp, sideOrientation: Mesh.DOUBLESIDE }, scene);
  cov.material = coverMat;
  refs.cover = cov;
  refs.coverMaterial = coverMat;

  // Hastiales con puerta opcional.
  [-halfL, halfL].forEach((zOff, idx) => {
    const zSign = idx === 0 ? -1 : 1;

    const hr = MeshBuilder.CreateBox(`hr_${name}_${idx}`,
      { width: width - 0.10, height: wallH, depth: 0.05 }, scene);
    hr.position.set(cx, wallH/2, cz + zOff);
    hr.material = materials.wall;

    // Hastial arqueado (ribbon plano).
    const wpts = [];
    for (let j = 0; j <= arcRes; j++) {
      const a = Math.PI * j / arcRes;
      wpts.push(new Vector3(cx + Math.cos(Math.PI - a) * halfW,
                            wallH + Math.sin(a) * domeH,
                            cz + zOff));
    }
    const wl = MeshBuilder.CreateRibbon(`wl_${name}_${idx}`, {
      pathArray: [wpts, Array(wpts.length).fill(new Vector3(cx, wallH, cz + zOff))],
      sideOrientation: Mesh.DOUBLESIDE,
    }, scene);
    wl.material = materials.cover;

    if (hasDoor) {
      const dW = width * 0.28, dH = wallH * 0.88;
      [-1, 1].forEach((s, i) => {
        const jb = MeshBuilder.CreateBox(`dj_${name}_${idx}_${i}`,
          { width: 0.08, height: dH, depth: 0.09 }, scene);
        jb.position.set(cx + s * dW/2, dH/2, cz + zOff);
        jb.material = materials.metal;
        shadowGen.addShadowCaster(jb);
      });
      const dl = MeshBuilder.CreateBox(`dl_${name}_${idx}`,
        { width: dW + 0.08, height: 0.07, depth: 0.09 }, scene);
      dl.position.set(cx, dH, cz + zOff);
      dl.material = materials.metal;
      shadowGen.addShadowCaster(dl);

      const dp = MeshBuilder.CreateBox(`dp_${name}_${idx}`,
        { width: dW - 0.04, height: dH - 0.04, depth: 0.03 }, scene);
      dp.position.set(cx, dH/2, cz + zOff);
      dp.material = materials.wall;

      refs.doors.push({ left: cx - dW/2, right: cx + dW/2, panel: dp });

      if (hasSanitary) {
        addSanitaryBox(scene, materials, shadowGen, cx, cz + zOff, zSign, width, wallH, `${name}_${idx}`);
      }
    }
  });

  // Solera base.
  [cx - halfW, cx + halfW].forEach((xb, i) => {
    if (i === 0 && skipLeftWall) return;
    if (i === 1 && skipRightWall) return;
    const base = MeshBuilder.CreateBox(`base_${name}_${i}`,
      { width: 0.13, height: 0.26, depth: length }, scene);
    base.position.set(xb, 0.13, cz);
    base.material = materials.metal;
    shadowGen.addShadowCaster(base);
  });

  return refs;
}
