# malinalco-render

Dashboard 3D en tiempo real para el complejo de invernaderos Acopinalco. Babylon.js 7 + Express + MQTT subscribe-only a Ubidots Industrial + transporte SSE backend->frontend.

## Stack

| Capa | Tecnologia |
|------|------------|
| Servidor | Node.js 20 + Express 4 |
| Datos | MQTT subscribe-only (mqtt 5.x) a Ubidots Industrial |
| Transporte real-time | SSE (Server-Sent Events) |
| Render 3D | Babylon.js 7 (CDN) |
| Logs | winston + winston-daily-rotate-file |
| Tests | vitest |

## Variables y sensores

Los 6 sensores y sus device labels viven en `src/sensorsMap.js`. Es el unico archivo que se edita cuando se cambian etiquetas o se agregan zonas.

| Zona            | device_label        |
|-----------------|---------------------|
| Engorda 1 norte | inv-engorda-1-n     |
| Engorda 1 sur   | inv-engorda-1-s     |
| Engorda 2 norte | inv-engorda-2-n     |
| Engorda 2 sur   | inv-engorda-2-s     |
| Habita 1        | inv-habita-1        |
| Habita 2        | inv-habita-2        |

Variables consumidas por cada sensor: `temperatura`, `humedad`.

## Requisitos

- Node.js 20 LTS o superior
- npm

## Instalacion

```bash
npm install
cp .env.example .env
# editar .env con tu UBIDOTS_TOKEN
```

## Ejecutar

```bash
npm start       # produccion
npm run dev     # con --watch (recarga al guardar)
```

Abrir `http://localhost:5000`.

## Modo mock (Fase 1)

Mientras se valida el flujo SSE end-to-end, dejar `MOCK_DATA=true` en el `.env`. El backend inyecta valores aleatorios cada 2s al snapshot store y los empuja por SSE. Util para desarrollar UI sin necesidad de Ubidots real.

Cuando se conecte MQTT real, poner `MOCK_DATA=false` o eliminar la linea.

## API

| Endpoint | Descripcion |
|----------|-------------|
| `GET /` | Dashboard con render 3D Babylon.js |
| `GET /api/config` | Metadata: sensores, rangos, umbrales |
| `GET /api/data` | Snapshot completo (hidratacion inicial) |
| `GET /api/stream` | SSE: empuja cambios del store en tiempo real |

## Tests

```bash
npm test
```

## Aviso de puertos

Este proyecto y `tenebrios-node` usan ambos el puerto 5000. **Solo uno puede correr a la vez** en la misma maquina.
