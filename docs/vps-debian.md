# Despliegue en VPS Debian (producción)

Guía para correr Malinalco Render como **servicio systemd** en un VPS con Debian 12 (bookworm) o superior. Despliegue **nativo, sin Docker** (Docker es solo para pruebas locales y no forma parte del repo de producción).

Cubre las dependencias de las features completas:
- **Agente IA** (Ollama Cloud) — chat conversacional.
- **Alertas + Telegram** — log SQLite (`better-sqlite3`).
- **Reportes PDF** — `puppeteer` con el **Chromium del sistema**.

## Requisitos

| | |
|---|---|
| SO | Debian 12 (bookworm) o superior |
| RAM | 1 GB mínimo (2 GB recomendado — Chromium para PDF consume al renderizar) |
| Node.js | 20+ |
| Salida a Internet | Ubidots (MQTT), Ollama Cloud (HTTPS), Telegram (HTTPS) |

## Instalación rápida (script)

```bash
sudo apt update && sudo apt install -y git
sudo git clone https://github.com/DLR-MEX/Malinalco-render.git /opt/malinalco-render
cd /opt/malinalco-render
sudo bash scripts/install-debian.sh
```

El script instala Chromium + libs + toolchain, Node 20, crea el usuario de servicio `malinalco`, hace `npm install --omit=dev` (sin descargar Chromium), genera `.env` y registra el servicio systemd. Al terminar:

```bash
sudo nano /opt/malinalco-render/.env     # poner credenciales (ver abajo)
sudo systemctl start malinalco-render
curl http://localhost:5000/api/health
```

## Instalación manual (paso a paso)

Si prefieres no usar el script:

### 1. Dependencias del sistema

```bash
sudo apt update
sudo apt install -y --no-install-recommends \
  curl ca-certificates git chromium \
  python3 make g++ \
  fonts-liberation libnss3 libatk-bridge2.0-0 libgbm1 libasound2 \
  libxshmfence1 libxss1 libgtk-3-0
```

> `chromium` instala `/usr/bin/chromium`, que es lo que usa `puppeteer` para los reportes PDF.
> `python3 make g++` solo se usan si `better-sqlite3` no encuentra un binario precompilado.

### 2. Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # v20.x.x o superior
```

### 3. Código + dependencias

```bash
sudo git clone https://github.com/DLR-MEX/Malinalco-render.git /opt/malinalco-render
cd /opt/malinalco-render
# puppeteer NO debe descargar su Chromium: usamos el del sistema.
sudo PUPPETEER_SKIP_DOWNLOAD=true npm install --omit=dev
```

### 4. Configurar `.env`

```bash
sudo cp .env.example .env
sudo nano .env
```

Valores típicos en producción:

```env
# --- Ubidots ---
UBIDOTS_TOKEN=BBFF-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
UBIDOTS_DEVICE=prueba_lora
MQTT_BROKER=industrial.api.ubidots.com
MQTT_TLS=true            # true => mqtts:// 8883 (recomendado en VPS)
MQTT_PORT=8883
WEB_HOST=0.0.0.0
WEB_PORT=5000
MOCK_DATA=false

# --- Agente IA (chat) ---
AGENT_ENABLED=true
OLLAMA_API_KEY=...        # https://ollama.com/settings/keys
OLLAMA_MODEL=gpt-oss:120b

# --- Alertas / Telegram (opcional) ---
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_CHAT_ID=-100xxxxxxxxxx

# --- Reportes PDF ---
REPORTS_ENABLED=true
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
```

> En VPS conviene `MQTT_TLS=true` (8883). El toggle `MQTT_TLS=false` (puerto 1883 plano) existe para entornos que lo requieran.

### 5. Servicio systemd

El repo trae `scripts/malinalco-render.service`. Cópialo y ajusta usuario/ruta si no usas los defaults (`malinalco` / `/opt/malinalco-render`):

```bash
sudo useradd --system --home-dir /opt/malinalco-render --shell /usr/sbin/nologin malinalco
sudo mkdir -p /opt/malinalco-render/logs /opt/malinalco-render/reports
sudo chown -R malinalco:malinalco /opt/malinalco-render

sudo cp scripts/malinalco-render.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now malinalco-render
sudo systemctl status malinalco-render
```

El unit fija `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium` y `PUPPETEER_SKIP_DOWNLOAD=true`. El resto de la config la lee la app del `.env` (vía dotenv) en su `WorkingDirectory`.

## Verificar

```bash
# En el VPS
curl http://localhost:5000/api/health
# {"ok":true,"mqtt_connected":true,...}

# Chat del agente
curl -s -X POST http://localhost:5000/api/agent/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"¿cómo están las zonas ahora?","history":[]}'

# Reporte PDF (ejercita puppeteer + Chromium)
curl -s -X POST http://localhost:5000/api/reports/generate \
  -H 'Content-Type: application/json' -d '{"hours":24}'

# Telegram (si está configurado)
curl -s -X POST http://localhost:5000/api/telegram/test
```

## Exponer a Internet

El servidor escucha en `WEB_PORT` (5000). Opciones:

**A) Puerto directo + firewall**

```bash
sudo ufw allow 5000/tcp
```

**B) Nginx como reverse proxy (recomendado, permite HTTPS)**

```nginx
# /etc/nginx/sites-available/malinalco
server {
    listen 80;
    server_name tu-dominio.com;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        # SSE: no bufferizar y mantener viva la conexión del stream
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 1h;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/malinalco /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
# HTTPS: sudo apt install certbot python3-certbot-nginx && sudo certbot --nginx
```

> `proxy_buffering off` es importante para que el stream SSE (`/api/stream`) llegue en tiempo real.

## Mantenimiento

```bash
# Actualizar
cd /opt/malinalco-render
sudo -u malinalco git pull
sudo PUPPETEER_SKIP_DOWNLOAD=true npm install --omit=dev
sudo systemctl restart malinalco-render

# Logs
journalctl -u malinalco-render -f
tail -f /opt/malinalco-render/logs/service.log

# Comandos
sudo systemctl {status|restart|stop} malinalco-render
```

## Resolución de problemas

### Reportes PDF fallan: "Could not find Chrome"
puppeteer busca su Chromium empaquetado en vez del del sistema. Verifica:
- `which chromium` → `/usr/bin/chromium`
- `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium` en el `.env` **y/o** en el unit systemd.
- Que la instalación usó `PUPPETEER_SKIP_DOWNLOAD=true`.

### Reportes fallan con error de sandbox
En algunos kernels Chromium headless necesita `--no-sandbox` (ya lo pasa la app). Si persiste, confirma que las libs (`libnss3`, `libgbm1`, etc.) están instaladas.

### `better-sqlite3` no carga / error de módulo nativo
Reinstala con toolchain presente:
```bash
sudo apt install -y python3 make g++
cd /opt/malinalco-render && sudo npm rebuild better-sqlite3
```

### MQTT no conecta
- `MQTT_TLS=true` + `MQTT_PORT=8883`: `openssl s_client -connect industrial.api.ubidots.com:8883 -quiet`
- `MQTT_TLS=false` + `MQTT_PORT=1883` para texto plano.
- Ver [`mqtt.md`](mqtt.md).

### El servicio arranca pero el dashboard está vacío
El device de Ubidots no está publicando, o `UBIDOTS_DEVICE` no coincide con un device cuyas variables estén en `src/sensorsMap.js`. Verifica el device y sus variables.
