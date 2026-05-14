// Suelo del complejo: tierra externa (gnd) e isla interna mas oscura (ignd).
// Valores originales (46x36 / 36x24, sin offset) registrados en docs/medidas.md.
// El piso se desplaza en X=-4.5 para alinearlo al centro del complejo, que va
// de X=-18 a X=+9 (asimétrico respecto al origen del mundo).

const { MeshBuilder } = BABYLON;

const COMPLEX_CENTER_X = -4.5;

export function buildGround(scene, materials) {
  const gnd = MeshBuilder.CreateGround('gnd', { width: 32, height: 26, subdivisions: 4 }, scene);
  gnd.position.x = COMPLEX_CENTER_X;
  gnd.material = materials.ground;
  gnd.receiveShadows = true;

  const ignd = MeshBuilder.CreateGround('ignd', { width: 30, height: 22 }, scene);
  ignd.position.x = COMPLEX_CENTER_X;
  ignd.position.y = 0.01;
  ignd.material = materials.floor;
  ignd.receiveShadows = true;

  return { gnd, ignd };
}
