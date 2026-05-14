# Medidas del render — valores originales

Referencia para revertir o ajustar las dimensiones de la escena 3D.  
Todas las medidas están en **unidades de mundo Babylon.js** (≈ metros).

## Piso (ground.js)

`public/js/meshes/ground.js`

| Mesh | Propósito | Valor original | Valor actual |
|---|---|---|---|
| `gnd` (tierra externa) | Superficie marrón alrededor del complejo | `width: 46, height: 36`, sin offset | `width: 32, height: 26`, `position.x = -4.5` |
| `ignd` (isla interna) | Suelo gris dentro del complejo | `width: 36, height: 24`, sin offset | `width: 30, height: 22`, `position.x = -4.5` |

> El offset `position.x = -4.5` alinea el piso con el centro real del complejo (X de -18 a +9). Antes el piso estaba centrado en el origen del mundo, dejando 9 unidades extra del lado derecho y 0 del lado izquierdo.

### Cómo revertir

Editar `public/js/meshes/ground.js`:

```js
const gnd  = MeshBuilder.CreateGround('gnd',  { width: 46, height: 36, subdivisions: 4 }, scene);
// sin gnd.position.x
const ignd = MeshBuilder.CreateGround('ignd', { width: 36, height: 24 }, scene);
// sin ignd.position.x
```

## Complejo (scene.js)

`public/js/scene.js` — líneas 32-41. **No tocar** si se cambia el piso; estas medidas dependen del backend (`sensorsMap.js`).

| Constante | Valor | Significado |
|---|---|---|
| `DOME_H` | `3.5` | Altura del domo (cúpula) sobre la pared |
| `WALL_H` | `1.8` | Altura de la pared vertical |
| `TUNNEL_L` | `20` | Largo de cada túnel (eje Z) |
| `ENG_W` | `9.0` | Ancho de cada túnel de Engorda (eje X) |
| `DEV_W` | `9.0` | Ancho del túnel de Desarrollo (eje X) |
| `ENG1_CX` | `-13.5` | Centro X del túnel Engorda 1 |
| `ENG2_CX` | `-4.5` | Centro X del túnel Engorda 2 |
| `DEV_CX` | `4.5` | Centro X del túnel Desarrollo |

**Ocupación total del complejo:**
- Eje X: de `-18` a `+9` → **27 unidades** de ancho
- Eje Z: de `-10` a `+10` → **20 unidades** de largo

## Habitas (habitas.js)

`public/js/meshes/habitas.js`

| Constante | Valor | Significado |
|---|---|---|
| `HAB_SIDE` | `5.5` | Lado de habita (cuadrada en planta) |
| `HAB_WALL_H` | `1.5` | Altura de pared de habita |
| `HAB_DOME_H` | `0.8` | Altura de la cúpula de habita |
| `HAB1_CZ` | `-4.6` | Centro Z de Habita 1 |
| `HAB2_CZ` | `4.6` | Centro Z de Habita 2 |

## Cámara (scene.js)

`public/js/scene.js` — líneas 65-76

| Parámetro | Valor original | Valor actual | Significado |
|---|---|---|---|
| Posición inicial | `α=-π/3.8, β=π/3.3, r=56` | igual | Ángulos y distancia inicial |
| Target | `(2, 1.5, 0)` | `(-4.5, 1.5, 0)` | Punto al que mira la cámara (centrada al complejo) |
| `lowerRadiusLimit` | `18` | igual | Zoom máximo (acercar) |
| `upperRadiusLimit` | `90` | igual | Zoom mínimo (alejar) |
| `upperBetaLimit` | `π/2.05` | igual | Límite superior de elevación |
| `lowerBetaLimit` | `π/8` | igual | Límite inferior de elevación |

> Si el piso recortado se ve corto desde el zoom máximo (alejar al límite), considerar reducir `upperRadiusLimit` para que la cámara no encuadre el borde del piso.

## Sensores (backend)

`src/sensorsMap.js` — posiciones 3D de los sensores. Mismas coordenadas que en `scene.js`. **No cambiar sin actualizar la documentación del proyecto** (CLAUDE.md regla 3).
