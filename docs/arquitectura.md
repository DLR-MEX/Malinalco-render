# Arquitectura

## Estructura de directorios

```
malinalco-render/
├── src/                    # Backend Node.js
│   ├── index.js            # Entry point — cablea todos los módulos
│   ├── config.js           # Variables de entorno y constantes del sistema
│   ├── sensorsMap.js       # Definición de zonas, sensores y mapeo a variables Ubidots
│   ├── mqttClient.js       # Cliente MQTT subscribe-only (TLS), parsea JSON con timestamp
│   ├── snapshotStore.js    # Estado en memoria, emite eventos 'change'
│   ├── sseHub.js           # Hub de clientes SSE
│   ├── server.js           # Express + endpoints
│   ├── logger.js           # Winston con rotación diaria
│   └── mockDriver.js       # Inyector de datos simulados para desarrollo
│
├── public/                 # Frontend estático servido por Express
│   ├── index.html
│   ├── css/styles.css
│   └── js/
│       ├── app.js          # Bootstrap, SSE, indicador de antigüedad del dato
│       ├── scene.js        # Motor Babylon.js, cámara, SSAO
│       ├── colorScales.js  # Paletas de color para temp/hum
│       ├── colorbar.js     # Overlay colorbar horizontal
│       ├── cards.js        # Panel lateral con barras por zona
│       ├── immersion.js    # Modo pantalla completa / kiosk
│       └── meshes/
│           ├── labels.js       # Etiquetas decorativas: Engorda, Desarrollo, Habitas, Cajón
│           ├── sensorLabels.js # Paneles de lectura por sensor (billboard + wall-mounted)
│           ├── heatVolume.js   # Heatmap volumétrico (isosuperficies Marching Cubes)
│           ├── habitas.js      # Geometría iglú — exporta HAB_SIDE, HAB_WALL_H, HAB1_CZ, HAB2_CZ
│           ├── tunnels.js      # Túneles de Engorda
│           ├── ground.js       # Suelo centrado en X=-4.5 (centro del complejo)
│           └── materials.js    # Materiales compartidos
│
├── docs/                   # Esta documentación
├── scripts/                # Scripts de instalación Windows (NSSM + Chrome kiosk)
│   ├── install_service.bat
│   ├── update_service.bat
│   ├── uninstall_service.bat
│   └── README.md
├── .env.example            # Plantilla de variables de entorno
└── package.json
```

## Módulos backend

### `config.js`
Fuente única de verdad para todas las constantes ajustables. Lee `.env` con `dotenv/config`. Ningún otro módulo hardcodea valores; todos importan de aquí.

Exports clave:
- Credenciales: `UBIDOTS_TOKEN`, `UBIDOTS_DEVICE`, `MQTT_BROKER`, `MQTT_PORT`
- Rangos colorscale: `TEMP_MIN/MAX`, `HUM_MIN/MAX`
- Validación física: `TEMP_VALID_MIN/MAX`, `HUM_VALID_MIN/MAX`
- Alertas: `TEMP_ALERT_LOW/HIGH`, `HUM_ALERT_LOW/HIGH`, `ALERT_WARN_MIN`, `ALERT_ERROR_MIN`

### `sensorsMap.js`
Define la topología física del invernadero. **Editar aquí si se agregan sensores o cambia la posición 3D.**

```
ZONES   → unidades lógicas: engorda, desarrollo, hab1, hab2
SENSORS → puntos físicos, cada uno con:
           - id, zone, tunnel
           - tempVariable / humVariable  (nombre en Ubidots)
           - coords3D { x, y, z }        (mundo Babylon.js)
           - displayLabels               (etiquetas 3D, una por modo)
           - wallNormal (opcional)       (para sensores pegados a pared)
```

Exports derivados:
- `VALID_KEYS` — Set de claves `"device/variable"` válidas para filtrado rápido en MQTT
- `ZONE_CAPACITY` — capacidad de sensores por zona (evita O(n²) en getAll)
- `resolveVariable(variable)` — devuelve `{ sensor, mode }` dado un nombre de variable Ubidots

### `mqttClient.js`
Subscribe-only. Nunca publica. Flujo interno:

```
connect() → subscribe(MQTT_TOPIC) → on('message') → parseLvMessage()
                                                   → isValidReading()
                                                   → store.update(device, variable, value, ts)
```

`parseLvMessage()` maneja dos formatos:
- **Dot complete** (tópico de 4 segmentos, payload JSON): extrae `value` y `timestamp` real del sensor.
- **Last value** legacy (tópico de 5 segmentos con `/lv`, payload string numérico): extrae solo `value`; `timestamp` es `null` y se sustituye por `Date.now()`.

Reconexión automática cada 1 s. El token Ubidots se usa como `username` (password vacío).

### `snapshotStore.js`
`EventEmitter` que extiende `Map`. Responsabilidades:
- Persistir el último valor recibido por variable
- Emitir `'change'` para que `sseHub` pueda hacer push inmediato
- Producir el snapshot agrupado por zona (`getAll()`) — estructura invariante que consume el frontend

### `sseHub.js`
Patrón publisher/subscriber sobre HTTP. Los clientes se registran con `register(res)`; el entry point les hace `broadcast()` en respuesta al evento `'change'` del store. Heartbeat cada 25 s.

### `server.js`
Express mínimo. Cuatro endpoints:

| Endpoint | Método | Descripción |
|---|---|---|
| `/` | GET | HTML con cache-busting por `BUILD_VERSION` |
| `/api/health` | GET | Liveness probe: uptime, mqtt_connected, sse_clients |
| `/api/config` | GET | Metadatos estáticos: zonas, sensores, rangos, umbrales |
| `/api/data` | GET | Snapshot completo (hidratación inicial o polling fallback) |
| `/api/stream` | GET | SSE — push de eventos `snapshot` y `data` |

Los estáticos (`public/`) se sirven con `no-store` para evitar que el navegador cache JS/CSS entre reinicios.

### `logger.js`
Winston con transporte `DailyRotateFile`. Genera logs en `logs/YYYY-MM/YYYY-MM-DD.log`. La carpeta del mes se crea automáticamente.

## Módulos frontend

### `app.js`
- Abre `EventSource` hacia `/api/stream`
- Al recibir `snapshot`: actualiza todos los componentes visuales
- Al recibir `data`: actualiza el timestamp del encabezado
- Maneja los modos de visualización (temperatura / humedad)
- Gestiona el **indicador de antigüedad**: `updateTimestamp()` + `refreshAge()` cada 15 s aplican clases CSS `age-fresh/warn/err` al encabezado según el tiempo transcurrido desde el último dato de Ubidots

### `scene.js`
- Inicializa el engine Babylon.js y la cámara ArcRotate (ortográfica)
- Configura SSAO2 para profundidad visual
- Construye los grupos de meshes una sola vez al inicio
- Los meshes **nunca se destruyen ni recrean** entre frames — se ocultan/muestran con `setVisibility`

### `meshes/sensorLabels.js`
Crea un plano con `DynamicTexture` por cada sensor. El plano tiene `BILLBOARDMODE_ALL` para sensores flotantes, o `BILLBOARDMODE_NONE` + rotación calculada para sensores pegados a pared (`wallNormal`):

```js
plane.rotation.y = Math.atan2(-n.x, -n.z);
```

Negar ambos componentes es necesario para alinear correctamente el frente del plano con la normal en cualquier orientación (norte, sur, este, oeste) dentro del sistema LHS de Babylon.js. Usar solo `atan2(-n.x, n.z)` produce texto en espejo en paredes con `n.z ≠ 0` (norte/sur).

Las etiquetas de sensor con `displayLabels` muestran temperatura y humedad simultáneamente (una etiqueta fija por modo). Las etiquetas simples cambian de magnitud según la tab activa (Temp/Hum).

### `meshes/heatVolume.js`
Implementa Marching Cubes inline (tablas Paul Bourke). Mantiene un **pool de 5 meshes reutilizables** para las 5 isosuperficies. Solo llama `vertexData.applyToMesh()` por frame — sin `new Mesh()` en el hot path.

## Decisiones de diseño clave

| Decisión | Razón |
|---|---|
| SSE en lugar de WebSocket | Unidireccional (server→client), reconexión automática del browser, sin dependencias adicionales |
| Pipeline unidireccional estricto | Seguridad + trazabilidad: el frontend nunca escribe datos |
| `VALID_KEYS` Set para filtrar MQTT | O(1) vs O(n) por mensaje en entornos de alta frecuencia |
| Meshes fijos, visibilidad toggled | Previene memory leaks y GC pauses en el hot path de render |
| `no-store` en estáticos | Garantiza que cambios de JS/CSS se reflejen sin Ctrl+F5 |
| `BUILD_VERSION` en URLs de assets | Bust de cache de proxy/CDN sin romper el header no-store |
| Coordenadas `p(x,y,z)` → Babylon `Vector3(x,z,y)` | Babylon usa Y-up; Plotly (sistema original) usaba Z-up |
| Tópico MQTT `/+` (dot complete) en lugar de `/+/lv` | El payload JSON incluye `timestamp` real del sensor — esencial para el indicador de antigüedad del dato |
| `atan2(-n.x, -n.z)` en etiquetas de pared | Negar ambos componentes evita texto en espejo para paredes norte/sur en el LHS de Babylon |
| Suelo y cámara centrados en X=-4.5 | El complejo ocupa X=-18..+9; X=-4.5 es el centro real del conjunto de túneles |

## Reglas invariantes

1. El pipeline de datos es **estrictamente unidireccional** — no hay escritura desde el frontend.
2. La estructura de `/api/data` es un contrato fijo — mismas claves, mismo anidamiento.
3. Las posiciones de sensores y dimensiones del cuarto solo se editan en `sensorsMap.js`.
4. El sensor exterior `tex` no participa en la interpolación volumétrica.
5. El conteo de meshes entre frames del mismo modo debe ser constante — nunca `dispose()` en el polling loop.
