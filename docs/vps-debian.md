# Despliegue en VPS Debian (producción, **sin sudo / usuario no-root**)

Guía para correr Malinalco Render en un VPS con Debian 12 (bookworm) o superior **sin privilegios de administrador**: todo se instala en tu `$HOME`, Node se instala con `nvm`, Chromium lo descarga el propio `puppeteer` (no el del sistema) y el proceso corre como **servicio de usuario de systemd** (`systemctl --user`). Despliegue **nativo, sin Docker**.

> ¿Tienes `sudo`? Entonces sigue la ruta clásica (servicio de sistema en `/opt`) descrita en el script `scripts/install-debian.sh` y en el `git log` de este archivo. Esta guía es **solo para el caso sin sudo**.

Cubre las dependencias de las features completas:
- **Agente IA** (Ollama Cloud) — chat conversacional.
- **Alertas + Telegram** — log SQLite (`better-sqlite3`).
- **Reportes PDF** — `puppeteer` con su **Chromium propio** (descargado en `~/.cache/puppeteer`).

## ⚠️ Qué SÍ necesita un administrador

Sin `sudo` la mayor parte funciona, pero hay tres cosas que **no puedes instalar tú** y que conviene pedir al admin del VPS **una sola vez** (o trabajar alrededor):

| Necesidad | Por qué | Si no lo tienes |
|---|---|---|
| **Librerías de Chromium** (`libnss3`, `libgbm1`, `libasound2`, `libatk-bridge2.0-0`, `libgtk-3-0`, `libxshmfence1`, `fonts-liberation`) | El Chromium que descarga puppeteer las necesita para arrancar; son paquetes del sistema (`apt`). | Pon `REPORTS_ENABLED=false` y desactivas los reportes PDF. El resto (dashboard, MQTT, agente, Telegram) funciona igual. |
| **Build tools** (`python3 make g++`) | Solo si `better-sqlite3` no encuentra binario precompilado para tu arquitectura. En x64/arm64 normalmente **sí** hay prebuild y no hace falta. | Si falla, pon `TELEGRAM_ENABLED=false` (el log de alertas SQLite es lo único que usa `better-sqlite3`). |
| **`loginctl enable-linger TU_USUARIO`** | Para que el servicio de usuario siga vivo al cerrar sesión y arranque solo tras un reinicio del VPS. | Sin linger, el servicio se detiene al salir; tendrás que arrancarlo a mano tras cada reinicio (o usar `tmux`). |

> **Pide al admin** (una sola vez):
> ```bash
> sudo apt update && sudo apt install -y --no-install-recommends \
>   fonts-liberation libnss3 libatk-bridge2.0-0 libgbm1 libasound2 \
>   libxshmfence1 libxss1 libgtk-3-0
> sudo loginctl enable-linger TU_USUARIO
> ```
> Con eso hecho, **todo lo demás de esta guía lo haces tú sin sudo.**

## Requisitos

| | |
|---|---|
| SO | Debian 12 (bookworm) o superior |
| RAM | 1 GB mínimo (2 GB recomendado — Chromium para PDF consume al renderizar) |
| Acceso | Usuario normal con `git` y `curl` disponibles (sin sudo) |
| Salida a Internet | Ubidots (MQTT), Ollama Cloud (HTTPS), Telegram (HTTPS) |

> Si `git` o `curl` no están instalados y no tienes sudo, pídeselos al admin (`sudo apt install -y git curl`).

## Instalación manual (paso a paso, sin sudo)

### 1. Node.js 20+ con `nvm` (sin sudo)

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
# recarga el shell para que 'nvm' esté disponible:
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

nvm install 20
nvm alias default 20
node --version    # v20.x.x o superior
```

### 2. Código + dependencias

```bash
git clone https://github.com/DLR-MEX/Malinalco-render.git ~/malinalco-render
cd ~/malinalco-render

# SIN sudo: dejamos que puppeteer descargue SU Chromium en ~/.cache/puppeteer
# (NO ponemos PUPPETEER_SKIP_DOWNLOAD; al contrario que en la ruta con sudo).
npm install --omit=dev
```

> Si solo necesitas el dashboard y quieres ahorrar la descarga de Chromium (~150 MB), puedes `export PUPPETEER_SKIP_DOWNLOAD=true` antes del `npm install` y poner `REPORTS_ENABLED=false` en el `.env`.

### 3. Configurar `.env`

```bash
cp .env.example .env
nano .env
```

Valores típicos en producción **sin sudo**:

```env
# --- Ubidots ---
UBIDOTS_TOKEN=BBFF-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
UBIDOTS_DEVICE=prueba_lora
MQTT_BROKER=industrial.api.ubidots.com
MQTT_TLS=true            # true => mqtts:// 8883 (recomendado en VPS)
MQTT_PORT=8883
WEB_HOST=0.0.0.0
WEB_PORT=5000            # >1024: no requiere privilegios
MOCK_DATA=false

# --- Agente IA (chat) ---
AGENT_ENABLED=true
OLLAMA_API_KEY=...        # https://ollama.com/settings/keys
OLLAMA_MODEL=gpt-oss:120b

# --- Alertas / Telegram (opcional) ---
TELEGRAM_ENABLED=true     # ponlo en false si better-sqlite3 no compila
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_CHAT_ID=-100xxxxxxxxxx

# --- Reportes PDF ---
REPORTS_ENABLED=true      # ponlo en false si faltan las libs de Chromium
# IMPORTANTE (sin sudo): dejar VACÍO para que puppeteer use su Chromium propio.
PUPPETEER_EXECUTABLE_PATH=
```

> **Clave del modo sin sudo:** `PUPPETEER_EXECUTABLE_PATH` **vacío**. Así puppeteer usa el Chromium que descargó en `~/.cache/puppeteer` en vez de buscar `/usr/bin/chromium` (que no puedes instalar).

### 4. Mantener la app corriendo en segundo plano

> **Realidad en este VPS (Debian, usuario `space-user2`, acceso por VPN+VNC):**
> `systemctl --user` **NO está disponible** — falla con
> `Failed to get properties: Process org.freedesktop.systemd1 exited with status 1`
> (no hay bus/gestor de systemd de usuario en la sesión). Por eso el método que
> se usa aquí es **`nohup`** (abajo). Las opciones systemd-user y pm2 quedan como
> alternativas para VPS que sí expongan el bus de usuario.

#### Opción A (la usada aquí) — `nohup` en segundo plano

Node de nvm + ruta absoluta del repo. Ejemplo real de este despliegue:

```bash
cd ~/Malinalco-render
mkdir -p logs reports

# Arrancar la app de fondo (logs anexados a logs/service.log):
nohup /home/space-user2/.nvm/versions/node/v20.20.2/bin/node src/index.js \
  >> ~/Malinalco-render/logs/service.log 2>&1 &
echo "PID de la app: $!"

# Verificar (espera unos segundos a que conecte MQTT):
sleep 4; curl -s localhost:5000/api/health; echo   # {"ok":true,"mqtt_connected":true,...}
```

> Sustituye la ruta del binario `node` por la tuya: `which node` (con nvm es algo como
> `~/.nvm/versions/node/vXX.XX.X/bin/node`). Los `nohup` **no** se reinician solos ni
> sobreviven a un reinicio del VPS — para eso, el `crontab @reboot` de abajo.

**Arranque automático tras reinicio (sin sudo) — `crontab @reboot`:**

```bash
crontab -e
```
```cron
# App (dashboard :5000)
@reboot /home/space-user2/.nvm/versions/node/v20.20.2/bin/node /home/space-user2/Malinalco-render/src/index.js >> /home/space-user2/Malinalco-render/logs/service.log 2>&1
# ngrok (espera 10s a que la app levante primero) — ver sección "Exponer a Internet"
@reboot sleep 10 && /snap/bin/ngrok http 5000 --log=stdout > /home/space-user2/ngrok.log 2>&1
```

**Gestión:**
```bash
pgrep -af "src/index.js"     # ver PID de la app
kill <PID>                   # detenerla
```

#### Opción B — Servicio de usuario systemd (si `systemctl --user` SÍ funciona)

Unit en `~/.config/systemd/user/malinalco-render.service` (sustituye `__NODE_BIN__`
por la salida de `nvm which 20`; ajusta el dir del repo):

```ini
[Unit]
Description=Malinalco Render - Dashboard 3D + Agente IA (Acopinalco)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=%h/Malinalco-render
ExecStart=__NODE_BIN__ src/index.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
StandardOutput=append:%h/Malinalco-render/logs/service.log
StandardError=append:%h/Malinalco-render/logs/service.log

[Install]
WantedBy=default.target
```
```bash
systemctl --user daemon-reload
systemctl --user enable --now malinalco-render
systemctl --user status malinalco-render
# Para que sobreviva al cierre de sesión / reinicio (requiere admin 1 vez):
#   sudo loginctl enable-linger TU_USUARIO
```

#### Opción C — `pm2`

```bash
npm install -g pm2          # con nvm, -g es tu dir de usuario: SIN sudo
cd ~/Malinalco-render
pm2 start src/index.js --name malinalco-render
pm2 logs malinalco-render
pm2 save
# pm2 startup (arranque al boot) requiere sudo. Sin él, usa el crontab @reboot de la Opción A.
```

## Verificar

```bash
# En el VPS
curl http://localhost:5000/api/health
# {"ok":true,"mqtt_connected":true,...}

# Chat del agente
curl -s -X POST http://localhost:5000/api/agent/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"¿cómo están las zonas ahora?","history":[]}'

# Reporte PDF (ejercita puppeteer + Chromium descargado)
curl -s -X POST http://localhost:5000/api/reports/generate \
  -H 'Content-Type: application/json' -d '{"hours":24}'

# Telegram (si está configurado)
curl -s -X POST http://localhost:5000/api/telegram/test
```

## Exponer a Internet (sin sudo)

El servidor escucha en `WEB_PORT` (5000), un puerto **>1024**, así que puedes abrirlo sin privilegios. Pero abrir firewall / puertos 80/443 / Nginx del sistema **requiere admin**. Sin sudo, la vía práctica es un **túnel** que expone `localhost:5000` con HTTPS sin tocar puertos del sistema.

### Túnel con ngrok (el usado aquí)

```bash
# (una sola vez) configurar el authtoken de tu cuenta — https://dashboard.ngrok.com
ngrok config add-authtoken TU_AUTHTOKEN

# Lanzar en segundo plano con log a archivo:
nohup ngrok http 5000 --log=stdout --log-format=logfmt > ~/ngrok.log 2>&1 &
echo "PID de ngrok: $!"

# Obtener la URL pública (ngrok expone una API local en el 4040):
sleep 4
curl -s http://localhost:4040/api/tunnels | grep -o 'https://[a-z0-9.-]*ngrok[a-z.-]*' | head -1
# -> https://xxxx-xx-xx-xx-xx.ngrok-free.app
```

> **Plan free de ngrok:** la URL (subdominio) **cambia en cada reinicio** de ngrok, y
> los visitantes ven una **página de aviso** ("Visit Site") antes del dashboard. Para una
> URL fija hace falta un dominio reservado en la cuenta ngrok.
>
> Para llamadas por API/curl que deben saltarse el aviso, añade la cabecera
> `-H "ngrok-skip-browser-warning: 1"`.

### Alternativas

- **Cloudflare Tunnel** (`cloudflared`, binario sin sudo en tu `$HOME`): URL estable con dominio propio, sin tocar puertos. Útil si ya lo tienes corriendo en el VPS.
- **Puerto directo 5000 / Nginx del sistema / HTTPS con certbot:** requieren admin (abrir `5000/tcp` en el firewall, o un Nginx hacia `127.0.0.1:5000` con `proxy_buffering off` para que el stream SSE de `/api/stream` llegue en tiempo real).

## Mantenimiento

```bash
# Actualizar
cd ~/Malinalco-render
git pull
npm install --omit=dev
# Reiniciar la app (Opción A / nohup): mátala y relánzala
pkill -f "src/index.js"
nohup /home/space-user2/.nvm/versions/node/v20.20.2/bin/node src/index.js \
  >> ~/Malinalco-render/logs/service.log 2>&1 &
# (Opción B systemd-user: systemctl --user restart malinalco-render)
# (Opción C pm2:         pm2 restart malinalco-render)

# Logs
tail -f ~/Malinalco-render/logs/service.log     # app
tail -f ~/ngrok.log                              # ngrok
```

## Resolución de problemas

### Reportes PDF fallan: "Could not find Chrome" / "Failed to launch the browser process"
Casi siempre es por **falta de las librerías del sistema** (que no puedes instalar sin sudo) o por `PUPPETEER_EXECUTABLE_PATH` mal puesto:
- Confirma que `PUPPETEER_EXECUTABLE_PATH` está **vacío** en el `.env` (modo sin sudo usa el Chromium propio).
- Verifica que el Chromium se descargó: `ls ~/.cache/puppeteer/chrome/`.
- Si el error menciona `libnss3.so`, `libgbm.so.1`, `libasound.so.2`, etc.: **pide al admin** que instale las libs de la tabla de arriba. Mientras tanto, `REPORTS_ENABLED=false`.

### Reportes fallan con error de sandbox
En algunos kernels Chromium headless necesita `--no-sandbox` (ya lo pasa la app). Si persiste, casi siempre faltan libs del sistema (ver arriba).

### `better-sqlite3` no carga / error de módulo nativo
No hubo prebuild para tu arquitectura y falta toolchain (que no puedes instalar sin sudo). Opciones:
- Pide al admin: `sudo apt install -y python3 make g++` y luego `npm rebuild better-sqlite3`.
- O desactiva la feature que lo usa: `TELEGRAM_ENABLED=false` en el `.env`.

### `systemctl --user` falla: "Failed to connect to bus" / "org.freedesktop.systemd1 exited with status 1"
El VPS no tiene bus de usuario / linger (es el caso de este despliegue). Usa la **Opción A (`nohup`)** o la **Opción C (`pm2`)** de la sección "Mantener la app corriendo".

### El servicio se detiene al cerrar la sesión SSH
Falta el linger. Pide al admin `sudo loginctl enable-linger TU_USUARIO`, o mantén el proceso en un `tmux`/`screen`.

### MQTT no conecta
- `MQTT_TLS=true` + `MQTT_PORT=8883`: `openssl s_client -connect industrial.api.ubidots.com:8883 -quiet`
- `MQTT_TLS=false` + `MQTT_PORT=1883` para texto plano.
- Ver [`mqtt.md`](mqtt.md).

### El servicio arranca pero el dashboard está vacío
El device de Ubidots no está publicando, o `UBIDOTS_DEVICE` no coincide con un device cuyas variables estén en `src/sensorsMap.js`. Verifica el device y sus variables.
