// Materiales PBR compartidos por todos los meshes del render. Valores extraidos
// del prototipo greenhouse_babylon_v10.html — no alterar sin necesidad porque
// definen la "personalidad" visual del invernadero (cubierta translucida,
// estructura metalica, hastiales claros).

const { PBRMaterial, Color3 } = BABYLON;

export function createMaterials(scene) {
  const metal = new PBRMaterial('metal', scene);
  metal.albedoColor = new Color3(0.18, 0.19, 0.17);
  metal.metallic = 0.85;
  metal.roughness = 0.40;
  metal.microSurface = 0.95;

  const cover = new PBRMaterial('cover', scene);
  cover.albedoColor = new Color3(0.91, 0.94, 0.97);
  cover.metallic = 0.0;
  cover.roughness = 0.18;
  cover.alpha = 0.12; // mas transparente para dejar ver el heatmap volumetrico
  cover.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
  cover.backFaceCulling = false;

  const wall = new PBRMaterial('wall', scene);
  wall.albedoColor = new Color3(0.91, 0.94, 0.97);
  wall.metallic = 0.0;
  wall.roughness = 0.20;
  wall.alpha = 0.18; // hastiales y paneles laterales mas translucidos
  wall.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
  wall.backFaceCulling = false;

  const sanitary = new PBRMaterial('san', scene);
  sanitary.albedoColor = new Color3(0.88, 0.89, 0.87);
  sanitary.metallic = 0.0;
  sanitary.roughness = 0.84;

  const frame = new PBRMaterial('frm', scene);
  frame.albedoColor = new Color3(0.28, 0.30, 0.26);
  frame.metallic = 0.80;
  frame.roughness = 0.36;

  const habita = new PBRMaterial('hab', scene);
  habita.albedoColor = new Color3(0.76, 0.68, 0.52);
  habita.metallic = 0.0;
  habita.roughness = 0.86;

  const ground = new PBRMaterial('gm', scene);
  ground.albedoColor = new Color3(0.18, 0.16, 0.11);
  ground.metallic = 0.0;
  ground.roughness = 0.98;

  const floor = new PBRMaterial('fm', scene);
  floor.albedoColor = new Color3(0.24, 0.20, 0.14);
  floor.metallic = 0.0;
  floor.roughness = 0.98;

  return { metal, cover, wall, sanitary, frame, habita, ground, floor };
}
