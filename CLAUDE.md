# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Real-time 3D dashboard for the Acopinalco greenhouse complex (Malinalco). A Node.js + Express backend subscribes (subscribe-only) to Ubidots Industrial over MQTT/TLS, holds the latest readings in memory, and pushes them to a Babylon.js 7 frontend over Server-Sent Events. The browser renders a volumetric heatmap of 6 sensors across 4 logical zones.

The repo root is `Malinalco-render/`; commands below run from there.

## Commands

```bash
npm install            # install deps
npm start              # production (node src/index.js)
npm run dev            # dev with --watch (auto-reload on save)
npm test               # run vitest suite once
npx vitest run tests/mqttParser.test.js   # single test file
npx vitest run -t "formato dot completo"  # tests matching a name
```

Dashboard serves at `http://localhost:5000` (`WEB_PORT`). Requires Node.js 20+.

First run: `cp .env.example .env`, then set `UBIDOTS_TOKEN`. To develop the UI/SSE pipeline without a real Ubidots connection, set `MOCK_DATA=true` — the mock driver injects random readings every 2s.

**Port conflict:** this project and `tenebrios-node` both bind port 5000. Only one can run at a time on the same machine.

## Data flow (strictly unidirectional)

```
Ubidots MQTT ──> mqttClient ──> SnapshotStore ──(emit 'change')──> index.js
                  (parse +        (in-memory                          │
                   validate)       last value/zone)                   ├─> sseHub.broadcast('snapshot', store.getAll())
                                                                      └─> sseHub.broadcast('data', {sensorId, zone, mode, ...})
                                                                              │
                                                            EventSource /api/stream ──> app.js ──> scene.js + cards.js
```

The frontend **never writes data back**. `index.js` is the wiring hub: it subscribes to the store's `'change'` event and fans every change out to all SSE clients as two events — a full recomputed `snapshot` (the single source of truth; the frontend does no local averaging) plus a lightweight `data` event used only to update the header timestamp.

In mock mode, `mockDriver` replaces `mqttClient` but feeds the same store; everything downstream is identical.

## Backend modules (`src/`)

- **`config.js`** — single source of truth for all tunable constants. Loads `.env` via `dotenv/config`. No other module hardcodes thresholds, ranges, or credentials; they all import from here.
- **`sensorsMap.js`** — **the only file to edit when adding/moving sensors or zones.** Defines `ZONES` (logical groupings) and `SENSORS` (physical points with `coords3D`, Ubidots `tempVariable`/`humVariable`, and 3D `displayLabels`). Derives `VALID_KEYS` (a Set for O(1) MQTT message filtering), `ZONE_CAPACITY` (precomputed to avoid O(n²) in `getAll()`), and `resolveVariable()`.
- **`mqttClient.js`** — subscribe-only, never publishes. `parseLvMessage()` handles two payload formats: **dot-complete** (4-segment topic, JSON `{value, timestamp, context}` — carries the sensor's real timestamp) and legacy **`/lv`** (5-segment topic, bare numeric string — no timestamp, caller falls back to `Date.now()`). `isValidReading()` rejects physically impossible values by variable suffix (`_temperature`/`_humidity`). Token is the MQTT username, password empty; auto-reconnect every 1s.
- **`snapshotStore.js`** — `EventEmitter` wrapping a `Map`. `getAll()` produces the zone-grouped snapshot (per-zone sensor list + avg/count/capacity/latestTs). **This structure is a fixed contract** consumed verbatim by the frontend.
- **`sseHub.js`** — publisher/subscriber over HTTP. Registers `res` objects, `broadcast()`s named events, heartbeats every 25s to survive idle-proxy timeouts.
- **`server.js`** — minimal Express. Endpoints: `GET /` (HTML with cache-bust query injected per asset), `/api/health`, `/api/config` (static metadata: zones, sensors, ranges, thresholds), `/api/data` (full snapshot for hydration/polling fallback), `/api/stream` (SSE). Statics served `no-store` so JS/CSS changes appear without hard-refresh. No helmet (would break external CDN CSP for Babylon/fonts).
- **`logger.js`** — winston with daily rotation into `logs/YYYY-MM/YYYY-MM-DD.log`.

## Frontend (`public/js/`)

Plain ES modules, no bundler. Babylon.js 7 loaded from CDN. `app.js` bootstraps: fetches `/api/config`, hydrates from `/api/data`, then opens `EventSource('/api/stream')`. `scene.js` owns the Babylon engine, ortho ArcRotate camera, and SSAO2.

Performance-critical invariants in the render hot path:
- **Meshes are built once and never disposed/recreated between frames** — visibility is toggled with `setVisibility`. Mesh count per mode must stay constant; never `dispose()` in the polling loop.
- `meshes/heatVolume.js` runs inline Marching Cubes (Paul Bourke tables) over a **pool of 5 reusable meshes** for the 5 isosurfaces; only `applyToMesh()` per frame, no `new Mesh()`.

The Temp/Hum tabs affect only the 3D render (heatmap + labels) and the colorbar. The sidebar shows Temp and Hum simultaneously and does **not** change with the tabs.

## Geometry conventions (must stay in sync)

The complex spans X = −18..+9; **ground and camera are centered at X = −4.5** (the true center of the tunnel set). The backend `sensorsMap.js` `coords3D` and the frontend `scene.js` dimension constants (`ENG1_CX=-13.5`, `ENG2_CX=-4.5`, `DEV_CX=4.5`, etc.) describe the same physical layout and must be edited together.

- Babylon is **Y-up**; the original Plotly prototype was Z-up. A point `p(x,y,z)` maps to Babylon `Vector3(x, z, y)`.
- Wall-mounted sensor labels (those with `wallNormal`) use `plane.rotation.y = Math.atan2(-n.x, -n.z)`. **Negating both components is required** to avoid mirrored text on north/south walls (`n.z ≠ 0`) in Babylon's left-handed system — `atan2(-n.x, n.z)` alone produces mirrored text.

## Deployment

Windows kiosk deployment uses NSSM to run the server as the `MalinalcoNode` service plus a Chrome kiosk Startup entry. See `scripts/README.md` (Windows) and `docs/raspberry-pi.md` (Linux/Pi). The `.bat` scripts in `scripts/` install/update/uninstall the service and reference an older `Tenebrio*` service that `remove_old_service.bat` cleans up.

## Docs

`docs/` holds the authoritative deep-dives in Spanish: `arquitectura.md` (module-by-module), `flujo.md`, `mqtt.md`, `medidas.md` (physical measurements), `instalacion.md`, `raspberry-pi.md`. The codebase and comments are in Spanish — match that when editing.
