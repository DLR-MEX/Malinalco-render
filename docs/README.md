# Documentación — Malinalco Render

Dashboard 3D en tiempo real para monitoreo ambiental del invernadero Acopinalco (tenebrios).  
Sensores IoT → Ubidots MQTT → Node.js → Babylon.js.

## Índice

| Documento | Descripción |
|---|---|
| [Flujo del proyecto](flujo.md) | Recorrido completo de un dato desde el sensor hasta el render |
| [Arquitectura](arquitectura.md) | Módulos, responsabilidades y decisiones de diseño |
| [Instalación y ejecución](instalacion.md) | Requisitos, variables de entorno y comandos |
| [MQTT y Ubidots](mqtt.md) | Protocolo, tópicos, formato de payload y variables |
| [Despliegue en Raspberry Pi](raspberry-pi.md) | Servicio systemd + Chromium kiosko en Raspberry Pi OS |
| [Medidas del render](medidas.md) | Dimensiones originales del piso/complejo/cámara, para revertir cambios visuales |

## Vista rápida

```
Sensor → Ubidots Industrial → MQTT TLS (8883)
           ↓
      mqttClient.js   ← suscribe /v1.6/devices/{device}/+
           ↓                    payload JSON {value, timestamp, context}
      snapshotStore.js ← almacena último valor + timestamp real del sensor
           ↓
      sseHub.js        ← empuja evento "snapshot" a clientes HTTP
           ↓
      app.js (frontend) → escena Babylon.js → heatmap 3D
                          indicador de antigüedad del último dato (age-fresh/warn/err)
```

## Stack

- **Runtime**: Node.js ≥ 20, ESM (`"type": "module"`)
- **Backend**: Express 4, MQTT.js 5, Winston, dotenv
- **Frontend**: Babylon.js 6 (CDN), vanilla ES modules
- **Tests**: Vitest
