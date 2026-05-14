# Despliegue en Raspberry Pi

Guía para correr Malinalco Render como servicio en una Raspberry Pi con Raspberry Pi OS (Debian-based) con arranque automático y kiosko en Chromium.

## Hardware recomendado

| Componente | Mínimo | Recomendado |
|---|---|---|
| Modelo | Raspberry Pi 4 — 2 GB RAM | Raspberry Pi 4/5 — 4 GB RAM |
| Almacenamiento | microSD 16 GB clase 10 | SSD USB 64 GB |
| Pantalla | HDMI 1080p | HDMI / TV LCD 1080p+ |
| Red | WiFi o Ethernet | Ethernet (estable para MQTT) |

> El render Babylon.js es **GPU-bound**. En Pi 3 funciona pero a baja fluidez; en Pi 4/5 va correcto.

## 1 — Sistema base

Instala **Raspberry Pi OS (64-bit) con escritorio**. Después de boot inicial:

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y curl git chromium-browser unclutter
```

## 2 — Instalar Node.js 20

Usar NodeSource (la versión de apt suele ser vieja):

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

node --version   # debe ser v20.x.x o superior
npm --version
```

## 3 — Clonar / copiar el proyecto

```bash
sudo mkdir -p /opt/malinalco
sudo chown $USER:$USER /opt/malinalco
cd /opt/malinalco

# Si lo copias por scp / USB:
#   scp -r usuario@pc:ruta/malinalco-render /opt/malinalco/
# Si lo clonas:
#   git clone <repo-url> malinalco-render

cd malinalco-render
bash scripts/setup.sh
```

## 4 — Configurar `.env`

```bash
cp .env.example .env
nano .env
```

Editar:

```env
UBIDOTS_TOKEN=BBUS-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
UBIDOTS_DEVICE=nombre-del-device
MQTT_BROKER=industrial.api.ubidots.com
MQTT_PORT=8883
WEB_HOST=0.0.0.0
WEB_PORT=5000
LOG_LEVEL=info
MOCK_DATA=false
```

## 5 — Servicio systemd

Crea el archivo de unidad:

```bash
sudo nano /etc/systemd/system/malinalco-render.service
```

Pega lo siguiente (ajusta `User=` si no usas `pi`):

```ini
[Unit]
Description=Malinalco Render - Dashboard 3D Acopinalco
Documentation=https://github.com/your-org/malinalco-render
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/opt/malinalco/malinalco-render
ExecStart=/usr/bin/node src/index.js
Restart=on-failure
RestartSec=5
StandardOutput=append:/opt/malinalco/malinalco-render/logs/service.log
StandardError=append:/opt/malinalco/malinalco-render/logs/service.log
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Activa y arranca el servicio:

```bash
sudo mkdir -p /opt/malinalco/malinalco-render/logs
sudo chown -R pi:pi /opt/malinalco/malinalco-render/logs

sudo systemctl daemon-reload
sudo systemctl enable malinalco-render
sudo systemctl start malinalco-render
sudo systemctl status malinalco-render
```

## 6 — Verificar

```bash
curl http://localhost:5000/api/health
# {"ok":true,"uptime":4.2,"mqtt_connected":true,"sse_clients":0}
```

Logs en vivo:

```bash
journalctl -u malinalco-render -f
# o
tail -f /opt/malinalco/malinalco-render/logs/service.log
```

## 7 — Chromium en kiosko al iniciar sesión

Crea el script de arranque:

```bash
mkdir -p ~/.config/autostart
nano ~/.config/autostart/malinalco-kiosk.desktop
```

Pega lo siguiente:

```ini
[Desktop Entry]
Type=Application
Name=Malinalco Kiosk
Exec=/bin/bash -c "sleep 15 && /usr/bin/chromium-browser --kiosk --noerrdialogs --disable-infobars --no-first-run --disable-translate --disable-features=TranslateUI --check-for-update-interval=31536000 http://localhost:5000"
X-GNOME-Autostart-enabled=true
```

> El `sleep 15` da tiempo al servicio de levantar antes de abrir el navegador.

### Ocultar el cursor

`unclutter` ya quedó instalado. Agrégalo también al autostart:

```bash
nano ~/.config/autostart/unclutter.desktop
```

```ini
[Desktop Entry]
Type=Application
Name=Unclutter
Exec=unclutter -idle 0.5 -root
```

### Auto-login (escritorio sin contraseña)

```bash
sudo raspi-config
# 1 → System Options
# 5 → Boot / Auto Login
# 4 → Desktop Autologin
```

### Deshabilitar protector de pantalla

```bash
sudo apt install -y xscreensaver
```

Abre **Screensaver** en el menú gráfico y elige **Disable Screen Saver**.

O por línea de comandos, agrega al inicio de `~/.config/lxsession/LXDE-pi/autostart`:

```
@xset s off
@xset -dpms
@xset s noblank
```

## Mantenimiento

### Actualizar el código

```bash
cd /opt/malinalco/malinalco-render
git pull            # si usas git
npm install
sudo systemctl restart malinalco-render
```

### Comandos systemd útiles

```bash
sudo systemctl status malinalco-render     # estado
sudo systemctl restart malinalco-render    # reiniciar
sudo systemctl stop malinalco-render       # detener
sudo systemctl disable malinalco-render    # desactivar arranque automático
journalctl -u malinalco-render -n 200      # últimas 200 líneas de log
```

### Desinstalar

```bash
sudo systemctl stop malinalco-render
sudo systemctl disable malinalco-render
sudo rm /etc/systemd/system/malinalco-render.service
sudo systemctl daemon-reload

rm ~/.config/autostart/malinalco-kiosk.desktop
rm ~/.config/autostart/unclutter.desktop
```

## Resolución de problemas

### Servicio no arranca

```bash
sudo systemctl status malinalco-render
journalctl -u malinalco-render -n 50
```

Causas frecuentes:
- `.env` no existe o falta `UBIDOTS_TOKEN`
- Puerto 5000 ocupado: `sudo lsof -i:5000`
- Permisos del usuario: `chown -R pi:pi /opt/malinalco/malinalco-render`

### Chromium se cierra al rato

Algunos firmwares antiguos tienen problemas con la GPU acelerada. Forzar render por software (más lento pero estable):

```bash
# Editar el desktop file y agregar al Exec=:
chromium-browser --kiosk --disable-gpu ...
```

### El render se ve lento

- Verifica que GL está activo: `chromium-browser` → abrir `chrome://gpu` → todo debe estar en verde
- Considera reducir `subdivisions` del piso en `public/js/meshes/ground.js`
- En Pi 3 o 4 con 2 GB, baja el zoom inicial (`r=56` → `r=42` en `public/js/scene.js` línea 65) — menos píxeles que renderizar

### MQTT no conecta

- Comprueba salida a Internet: `ping industrial.api.ubidots.com`
- Verifica TLS: `openssl s_client -connect industrial.api.ubidots.com:8883 -quiet`
- Revisa que `MQTT_PORT=8883` en `.env`
- Ver detalles en [`mqtt.md`](mqtt.md)
