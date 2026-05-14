# Flujo del proyecto

Recorrido completo de un dato ambiental desde el sensor físico hasta el render 3D.

## Diagrama general

```
┌─────────────┐     LoRa / WiFi      ┌──────────────────┐
│  Sensor IoT │ ──────────────────►  │ Ubidots Industrial│
│ (SFTHx / SITHx / SICOx)           │ industrial.api.   │
└─────────────┘                      │ ubidots.com       │
                                     └────────┬──────────┘
                                              │  MQTT TLS :8883
                                              │  tópico: /v1.6/devices/{device}/+/lv
                                              ▼
                                     ┌──────────────────┐
                                     │  mqttClient.js   │  parsea, valida, actualiza
                                     └────────┬──────────┘
                                              │  store.update(device, variable, value)
                                              ▼
                                     ┌──────────────────┐
                                     │ snapshotStore.js │  Map en memoria, emite 'change'
                                     └────────┬──────────┘
                                              │  store.on('change', ...)
                                              ▼
                                     ┌──────────────────┐
                                     │   sseHub.js      │  broadcast 'snapshot' + 'data'
                                     └────────┬──────────┘
                                              │  SSE (text/event-stream)
                                              ▼
                                     ┌──────────────────┐
                                     │  app.js (browser)│  EventSource /api/stream
                                     └────────┬──────────┘
                                              │  actualiza escena Babylon.js
                                              ▼
                                     ┌──────────────────┐
                                     │  Render 3D       │  heatmap volumétrico + etiquetas
                                     └──────────────────┘
```

## Paso a paso

### 1. Sensor → Ubidots

Los sensores (SFTH, SITH, SICO2) transmiten temperatura y humedad por LoRa o WiFi hacia la plataforma Ubidots Industrial. Ubidots almacena cada lectura como una variable dentro del device configurado (`UBIDOTS_DEVICE`).

### 2. Ubidots → mqttClient.js

Al arrancar, `MqttClient.start()` abre una conexión **MQTT sobre TLS** al broker de Ubidots:

```
mqtts://industrial.api.ubidots.com:8883
```

Se suscribe al tópico wildcard:

```
/v1.6/devices/{UBIDOTS_DEVICE}/+/lv
```

El `+` captura **todas las variables** del device. El sufijo `/lv` indica *last value* — Ubidots publica el valor más reciente cuando hay una nueva lectura.

Cada mensaje entrante pasa por `parseLvMessage()`:
- Extrae el nombre de la variable del tópico
- Verifica que la clave `{device}/{variable}` esté en `VALID_KEYS` (definido en `sensorsMap.js`)
- Convierte el payload (cadena numérica plana, ej. `"25.4"`) a `Number`

Luego `isValidReading()` descarta valores fuera del rango físicamente posible (`TEMP_VALID_MIN/MAX`, `HUM_VALID_MIN/MAX`). Los valores rechazados se loguean y se **ignoran** — el store conserva el último valor bueno.

### 3. snapshotStore.js — estado en memoria

`SnapshotStore` mantiene un `Map<"device/variable", { value, ts }>` con el último valor recibido por cada variable. Cada llamada a `update()` persiste el valor y emite el evento `'change'`.

`getAll()` construye el snapshot agrupado por zona:

```json
{
  "lastUpdate": 1715712345678,
  "zones": [
    {
      "id": "engorda",
      "label": "Engorda",
      "sensors": [...],
      "temp": { "avg": 23.5, "count": 3, "capacity": 3, "latestTs": 1715712345678 },
      "hum":  { "avg": 61.2, "count": 3, "capacity": 3, "latestTs": 1715712340000 }
    }
  ]
}
```

### 4. sseHub.js — push en tiempo real

`SseHub` mantiene un `Set` de respuestas HTTP activas. Cuando el store emite `'change'`, el entry point (`index.js`) llama a `sseHub.broadcast()` dos veces:

| Evento SSE | Payload | Uso |
|---|---|---|
| `snapshot` | `store.getAll()` completo | Hidratar toda la UI |
| `data` | `{ device, variable, value, ts, sensorId, zone, mode }` | Reaccionar a un sensor individual |

Un heartbeat (comentario SSE cada 25 s) mantiene vivas las conexiones detrás de proxies que cierran HTTP idle.

### 5. Frontend — app.js

El navegador abre un `EventSource` hacia `/api/stream`. Al conectar recibe inmediatamente un evento `snapshot` con el estado completo (hidratación inicial). Los eventos posteriores actualizan la escena incrementalmente.

`app.js` llama a las funciones de `scene.js` para actualizar:
- Colores de los meshes del heatmap volumétrico (`heatVolume.js`)
- Texto de las etiquetas de sensor (`sensorLabels.js`)
- Barras del panel lateral (`cards.js`)
- Colorbar del overlay (`colorbar.js`)

### 6. Modo mock (desarrollo)

Si `MOCK_DATA=true` en `.env`, `mockDriver.js` inyecta valores aleatorios directamente en el store cada 2 s, sin conectar a Ubidots. Útil para desarrollo sin acceso a sensores físicos.
