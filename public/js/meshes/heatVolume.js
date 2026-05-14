// Volumen de calor por tunel: N "lonjas" semitransparentes apiladas a lo largo
// del eje Z del tunel. Cada lonja tiene la silueta REAL del tunel (rectangulo
// vertical hasta wallH + arco semicircular del domo), no un plano rectangular,
// para que el calor no "sobresalga" de la estructura.
//
// El color de cada lonja se interpola linealmente entre el sensor norte (Z<0)
// y el sensor sur (Z>0) del tunel. El blending acumulado de N lonjas con alpha
// bajo da el efecto de "nube" volumetrica, equivalente a la tecnica de tenebrios.

import { colorForValue } from '../colorScales.js';

const { Mesh, VertexData, StandardMaterial, Color3 } = BABYLON;

// 3 niveles de densidad seleccionables por region via `heatDensity`:
//   low    = tunel grande con pocos sensores (Desarrollo: 1 sensor)
//   normal = tunel grande estandar (Engorda)
//   high   = region pequena (habitas, alta densidad para que se vea bien)
// Si la region no especifica heatDensity, se infiere por length:
//   length < 10m -> high, else normal.
const DENSITY = {
    low:    { nSlices: 18, alpha: 0.10 },
    normal: { nSlices: 22, alpha: 0.13 },
    high:   { nSlices: 44, alpha: 0.16 },
};
const SMALL_REGION_LENGTH = 10;

const SLICE_MARGIN = 0.4;
const ARC_RES = 24;

let _volumes = {};

/**
 * Construye una mesh 2D con la silueta del tunel (rectangulo + semicirculo)
 * en el plano XY (normal hacia +Z). Triangulacion fan desde un punto central.
 */
function buildSliceMesh(scene, name, width, wallH, domeH) {
    const halfW = width / 2;

    // Vertices del perimetro: piso izq -> tope izq -> arco -> tope der -> piso der.
    const perimeter = [];
    perimeter.push([-halfW, 0]);
    perimeter.push([-halfW, wallH]);
    for (let i = 1; i < ARC_RES; i++) {
        const a = Math.PI * i / ARC_RES;
        perimeter.push([
            Math.cos(Math.PI - a) * halfW,
            wallH + Math.sin(a) * domeH,
        ]);
    }
    perimeter.push([halfW, wallH]);
    perimeter.push([halfW, 0]);

    // Triangulacion fan desde el centro de la silueta.
    const positions = [0, (wallH + domeH * 0.5) / 2, 0];
    for (const [x, y] of perimeter) positions.push(x, y, 0);

    const indices = [];
    const N = perimeter.length;
    for (let i = 1; i <= N; i++) {
        const next = (i === N) ? 1 : i + 1;
        indices.push(0, i, next);
    }

    const mesh = new Mesh(name, scene);
    const vd = new VertexData();
    vd.positions = positions;
    vd.indices = indices;
    // Normales hacia +Z para que la luz no afecte (el material igual desactiva lighting)
    vd.normals = new Array(positions.length).fill(0).map((_, i) => i % 3 === 2 ? 1 : 0);
    vd.applyToMesh(mesh);
    return mesh;
}

/**
 * `regions` es una lista de regiones con heatmap. Cada region: { name, cx, cz,
 * width, wallH, domeH, length }. La region puede ser un tunel grande o una
 * mini-habita. Cualquier region que NO se incluya en este array no tendra
 * heatmap (por ejemplo el tunel Desarrollo).
 */
export function buildHeatVolume(scene, regions, sensorsMeta) {
    _volumes = {};

    for (const r of regions) {
        const halfL = r.length / 2;
        // Densidad explicita en la region o inferida por length.
        const densityKey = r.heatDensity
            || (r.length < SMALL_REGION_LENGTH ? 'high' : 'normal');
        const { nSlices, alpha: sliceAlpha } = DENSITY[densityKey] || DENSITY.normal;

        const inRegion = sensorsMeta
            .filter((s) => s.tunnel === r.name)
            .slice()
            .sort((a, b) => a.coords3D.z - b.coords3D.z);
        const north = inRegion[0] ?? null;
        const south = inRegion[inRegion.length - 1] ?? null;

        const slices = [];

        for (let i = 0; i < nSlices; i++) {
            const zRel = -halfL + SLICE_MARGIN +
                (i / (nSlices - 1)) * (r.length - 2 * SLICE_MARGIN);

            const slice = buildSliceMesh(scene, `heat_${r.name}_${i}`,
                r.width, r.wallH, r.domeH);
            slice.position.x = r.cx;
            slice.position.z = r.cz + zRel;
            slice.isPickable = false;
            slice.alphaIndex = 5000 + i;

            const mat = new StandardMaterial(`heatMat_${r.name}_${i}`, scene);
            mat.disableLighting = true;
            mat.emissiveColor = new Color3(0.5, 0.5, 0.5);
            mat.diffuseColor = new Color3(0, 0, 0);
            mat.specularColor = new Color3(0, 0, 0);
            mat.alpha = sliceAlpha;
            mat.backFaceCulling = false;
            slice.material = mat;
            slice.isVisible = false;

            slices.push({ mesh: slice, mat, zRel });
        }

        _volumes[r.name] = {
            slices,
            cz: r.cz,
            northSensorId: north?.id ?? null,
            southSensorId: south?.id ?? null,
            northZ: north?.coords3D.z ?? null,
            southZ: south?.coords3D.z ?? null,
        };
    }
}

export function updateHeatVolume(snapshot, mode) {
    // Aplanar todos los sensores del snapshot por id para acceso rapido
    const byId = {};
    for (const z of snapshot.zones) {
        for (const s of z.sensors) byId[s.id] = s;
    }

    for (const vol of Object.values(_volumes)) {
        // Si la region no tiene sensores asignados, ocultar todos sus slices.
        if (!vol.northSensorId && !vol.southSensorId) {
            for (const s of vol.slices) s.mesh.isVisible = false;
            continue;
        }

        const north = vol.northSensorId ? byId[vol.northSensorId] : null;
        const south = vol.southSensorId ? byId[vol.southSensorId] : null;

        const vN = north?.[mode]?.value ?? null;
        const vS = south?.[mode]?.value ?? null;

        if (vN === null && vS === null) {
            for (const s of vol.slices) s.mesh.isVisible = false;
            continue;
        }

        // Si solo un extremo tiene valor numerico, usar ese para todo el volumen.
        // Si ambos extremos coinciden (1 solo sensor en la region o north===south),
        // el volumen entero queda con un color uniforme.
        const valueN = vN ?? vS;
        const valueS = vS ?? vN;
        const sameSensor = vol.northSensorId === vol.southSensorId;
        const dz = (vol.southZ ?? 0) - (vol.northZ ?? 0);

        for (const slice of vol.slices) {
            let t;
            if (sameSensor || dz === 0) {
                t = 0; // uniforme
            } else {
                const zAbs = vol.cz + slice.zRel;
                t = (zAbs - vol.northZ) / dz;
                t = Math.max(0, Math.min(1, t));
            }
            const v = valueN + (valueS - valueN) * t;
            const hex = colorForValue(v, mode);
            const c = slice.mat.emissiveColor;
            c.r = parseInt(hex.slice(1, 3), 16) / 255;
            c.g = parseInt(hex.slice(3, 5), 16) / 255;
            c.b = parseInt(hex.slice(5, 7), 16) / 255;
            slice.mesh.isVisible = true;
        }
    }
}

export function setHeatVolumeVisibility(visible) {
    for (const vol of Object.values(_volumes)) {
        for (const s of vol.slices) s.mesh.isVisible = visible;
    }
}
