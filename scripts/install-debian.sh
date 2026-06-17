#!/usr/bin/env bash
# Instalador de Malinalco-render como servicio systemd en un VPS Debian (12+).
#
# Despliegue NATIVO (sin Docker). Cubre las dependencias de las nuevas features:
#   - Chromium del sistema para puppeteer (reportes PDF, Fase 4).
#   - Toolchain para compilar better-sqlite3 si no hay prebuild (alert log, Fase 3).
#
# Uso (como root, dentro del repo ya clonado):
#   sudo bash scripts/install-debian.sh
#
# Variables opcionales:
#   SERVICE_USER=malinalco   APP_DIR=/opt/malinalco-render
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Ejecuta como root: sudo bash scripts/install-debian.sh" >&2
  exit 1
fi

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE_USER="${SERVICE_USER:-malinalco}"

echo "==> App dir:      $APP_DIR"
echo "==> Service user: $SERVICE_USER"

echo "==> 1/6 Dependencias del sistema (Chromium + libs + build tools)"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  curl ca-certificates git \
  chromium \
  python3 make g++ \
  fonts-liberation libnss3 libatk-bridge2.0-0 libgbm1 libasound2 \
  libxshmfence1 libxss1 libgtk-3-0

echo "==> 2/6 Node.js 20+"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/v//;s/\..*//')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
node --version

echo "==> 3/6 Usuario de servicio ($SERVICE_USER)"
if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
fi

echo "==> 4/6 Dependencias de la app (solo production; puppeteer no descarga Chromium)"
cd "$APP_DIR"
export PUPPETEER_SKIP_DOWNLOAD=true
npm install --omit=dev --no-audit --no-fund

echo "==> 5/6 .env y carpetas de runtime"
if [ ! -f .env ]; then
  cp .env.example .env
  echo "    >> Creado .env desde .env.example."
  echo "    >> EDITA $APP_DIR/.env (UBIDOTS_TOKEN, UBIDOTS_DEVICE, OLLAMA_API_KEY, ...) antes de arrancar."
fi
mkdir -p logs reports
chown -R "$SERVICE_USER":"$SERVICE_USER" "$APP_DIR"

echo "==> 6/6 Servicio systemd"
# Genera el unit con el APP_DIR/usuario reales (por si no son los defaults).
sed -e "s#^User=.*#User=$SERVICE_USER#" \
    -e "s#^WorkingDirectory=.*#WorkingDirectory=$APP_DIR#" \
    -e "s#^ExecStart=.*#ExecStart=/usr/bin/node src/index.js#" \
    -e "s#append:/opt/malinalco-render/logs/service.log#append:$APP_DIR/logs/service.log#g" \
    scripts/malinalco-render.service > /etc/systemd/system/malinalco-render.service
systemctl daemon-reload
systemctl enable malinalco-render

echo
echo "Listo. Pasos finales:"
echo "  1) Edita $APP_DIR/.env (credenciales)."
echo "  2) sudo systemctl start malinalco-render"
echo "  3) curl http://localhost:5000/api/health"
