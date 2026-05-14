// Habita 1 y Habita 2 dentro del tunel de Desarrollo.
//
// AMBAS habitas tienen estructura tipo mini-tunel translucido (tubos + tela),
// con planta cuadrada (width = length) y mismo perfil. Se renderiza heatmap
// volumetrico dentro de cada una usando sus 2 sensores en paredes opuestas.

import { createTunnel } from './tunnels.js';

// Dimensiones compartidas de las habitas (cuadradas en planta).
export const HAB_SIDE = 5.5;      // ancho = profundidad — habita cuadrada
export const HAB_WALL_H = 1.5;    // paredes verticales mas altas que antes
export const HAB_DOME_H = 0.8;    // cupula arqueada — altura total = 2.3m

// Posiciones Z de cada habita (centradas en el tunel Desarrollo)
export const HAB1_CZ = -4.6;
export const HAB2_CZ = 4.6;

// Layouts exportados para que scene.js construya las regiones del heatmap.
export const HAB1_LAYOUT = {
    cz: HAB1_CZ, width: HAB_SIDE,
    domeH: HAB_DOME_H, wallH: HAB_WALL_H, length: HAB_SIDE,
};
export const HAB2_LAYOUT = {
    cz: HAB2_CZ, width: HAB_SIDE,
    domeH: HAB_DOME_H, wallH: HAB_WALL_H, length: HAB_SIDE,
};

export function buildHabitas(scene, materials, shadowGen, devCX, devW) {
    // Habita 1 — mini-tunel translucido cuadrado
    const hab1 = createTunnel(scene, materials, shadowGen, 'hab1',
        devCX, HAB1_CZ, HAB_SIDE, HAB_DOME_H, HAB_WALL_H, HAB_SIDE, 5,
        { hasDoor: false, hasSanitary: false, skipLeftWall: false, skipRightWall: false });

    // Habita 2 — misma forma que Habita 1
    const hab2 = createTunnel(scene, materials, shadowGen, 'hab2',
        devCX, HAB2_CZ, HAB_SIDE, HAB_DOME_H, HAB_WALL_H, HAB_SIDE, 5,
        { hasDoor: false, hasSanitary: false, skipLeftWall: false, skipRightWall: false });

    return {
        hab1, hab2,
        habW: HAB_SIDE,
        habH: HAB_WALL_H + HAB_DOME_H,
        habD: HAB_SIDE,
    };
}
