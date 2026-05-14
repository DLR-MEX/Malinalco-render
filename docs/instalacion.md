# Instalación y ejecución

## Requisitos

| Herramienta | Versión mínima | Notas |
|---|---|---|
| Node.js | 20.x LTS | ESM nativo requerido |
| npm | 10.x | Incluido con Node 20 |
| Cuenta Ubidots | Industrial | Para datos reales |

> Para desarrollo sin sensores físicos, `MOCK_DATA=true` elimina la dependencia de Ubidots.

## Instalación

```bash
# 1. Clonar / copiar el proyecto
cd malinalco-render

# 2. Instalar dependencias
npm install

# 3. Configurar variables de entorno
cp .env.example .env
# Editar .env con los valores reales (ver sección Variables de entorno)
```

## Variables de entorno

El archivo `.env` en la raíz del proyecto contiene toda la configuración. **No commitear este archivo** — contiene credenciales.

```env
# ─── Ubidots / MQTT ──────────────────────────────────────────
# Token de autenticación de Ubidots Industrial
UBIDOTS_TOKEN=BBUS-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Label del device en Ubidots (aparece en la URL del device)
UBIDOTS_DEVICE=nombre-del-device

# Broker MQTT — Ubidots Industrial usa TLS en puerto 8883
MQTT_BROKER=industrial.api.ubidots.com
MQTT_PORT=8883

# ─── Servidor web ─────────────────────────────────────────────
# 0.0.0.0 escucha en todas las interfaces (LAN + localhost)
WEB_HOST=0.0.0.0
WEB_PORT=5000

# ─── Logging ──────────────────────────────────────────────────
# Niveles: debug | info | warn | error
LOG_LEVEL=info

# ─── Modo desarrollo ──────────────────────────────────────────
# true: inyecta datos simulados sin conectar a Ubidots
MOCK_DATA=false
```

### Cómo obtener el UBIDOTS_TOKEN

1. Ingresar a [app.ubidots.com](https://app.ubidots.com) con cuenta Industrial
2. Menú superior derecho → **API Credentials**
3. Copiar el token que empieza con `BBUS-`

### Cómo obtener el UBIDOTS_DEVICE

Es el **label** (no el nombre) del device en Ubidots. Se ve en la URL:  
`https://industrial.ubidots.com/app/devices/`**`nombre-del-device`**

## Comandos

### Producción

```bash
npm start
# → node src/index.js
# → Servidor en http://0.0.0.0:5000
```

### Desarrollo (hot-reload)

```bash
npm run dev
# → node --watch src/index.js
# El servidor se reinicia automáticamente al guardar archivos src/
```

### Tests

```bash
# Todos los tests
npm test

# Un archivo específico
npx vitest run tests/interpolation.test.js

# Modo watch (re-ejecuta al guardar)
npx vitest
```

### Mock data (sin Ubidots)

```bash
# Opción 1: variable de entorno en línea
MOCK_DATA=true npm start

# Opción 2: editar .env y poner MOCK_DATA=true, luego:
npm start
```

## Verificar que funciona

1. Abrir `http://localhost:5000` — debe cargar la escena 3D
2. El indicador de conexión debe mostrar **Conectado** (verde)
3. Revisar el endpoint de salud:
   ```bash
   curl http://localhost:5000/api/health
   # {"ok":true,"uptime":12.3,"mqtt_connected":true,"sse_clients":1}
   ```
4. Revisar el snapshot de datos:
   ```bash
   curl http://localhost:5000/api/data
   ```

## Instalación como servicio Windows (kiosk)

Los scripts de `scripts/` instalan el servidor como servicio Windows con NSSM y abren Chrome en modo kiosk al iniciar. Ejecutar como **Administrador**:

```bat
scripts\install_service.bat    # instala + activa servicio
scripts\update_service.bat     # pull deps + reinicia servicio
scripts\uninstall_service.bat  # revierte todo
```

Ver `scripts/README.md` para detalles.

## Logs

Los logs se guardan en `logs/YYYY-MM/YYYY-MM-DD.log` con rotación diaria. Para seguirlos en tiempo real:

```bash
# Windows PowerShell
Get-Content logs\$(Get-Date -Format 'yyyy-MM')\$(Get-Date -Format 'yyyy-MM-dd').log -Wait -Tail 50

# Git Bash / WSL
tail -f logs/$(date +%Y-%m)/$(date +%Y-%m-%d).log
```
