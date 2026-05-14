# Despliegue en Raspberry Pi

Guía para correr Malinalco Render como **servicio de red** en una Raspberry Pi con Raspberry Pi OS. El servidor queda accesible desde cualquier navegador en la red local; no hay pantalla ni kiosko en la propia Pi.

## Hardware recomendado

| Componente | Mínimo | Recomendado |
|---|---|---|
| Modelo | Raspberry Pi 4 — 2 GB RAM | Raspberry Pi 4/5 — 4 GB RAM |
| Almacenamiento | microSD 16 GB clase 10 | SSD USB 32 GB |
| Red | WiFi | Ethernet (más estable para MQTT continuo) |
| Pantalla | No requerida | — |

## 1 — Sistema base

Instala **Raspberry Pi OS Lite (64-bit)** — la versión sin escritorio es suficiente y más liviana. Después del boot inicial:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git
```

## 2 — Instalar Node.js 20

La versión de apt suele ser antigua. Usar NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

node --version   # debe mostrar v20.x.x o superior
npm --version
```

## 3 — Clonar el repositorio

```bash
cd /home/spaces
git clone https://github.com/DLR-MEX/Malinalco-render.git malinalco-render
cd malinalco-render
npm install
```

## 4 — Configurar `.env`

```bash
cp .env.example .env
nano .env
```

Valores mínimos necesarios:

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

> `WEB_HOST=0.0.0.0` es obligatorio para que el servidor acepte conexiones desde la red, no solo desde localhost.

## 5 — Servicio systemd

Crea el archivo de unidad:

```bash
sudo nano /etc/systemd/system/malinalco-render.service
```

Pega lo siguiente:

```ini
[Unit]
Description=Malinalco Render - Dashboard 3D Acopinalco
Documentation=https://github.com/DLR-MEX/Malinalco-render
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=spaces
WorkingDirectory=/home/spaces/malinalco-render
ExecStart=/usr/bin/node src/index.js
Restart=on-failure
RestartSec=5
StandardOutput=append:/home/spaces/malinalco-render/logs/service.log
StandardError=append:/home/spaces/malinalco-render/logs/service.log
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Activa el servicio:

```bash
mkdir -p /home/spaces/malinalco-render/logs

sudo systemctl daemon-reload
sudo systemctl enable malinalco-render
sudo systemctl start malinalco-render
sudo systemctl status malinalco-render
```

## 6 — Verificar

Desde la propia Pi:

```bash
curl http://localhost:5000/api/health
# {"ok":true,"uptime":4.2,"mqtt_connected":true,"sse_clients":0}
```

Desde otro equipo en la misma red, abrir en el navegador:

```
http://<IP-de-la-Pi>:5000
```

Para saber la IP de la Pi:

```bash
hostname -I
```

## 7 — Ver logs

```bash
# Logs del sistema (systemd journal)
journalctl -u malinalco-render -f

# Log de archivo (rotación diaria por Winston)
tail -f /home/spaces/malinalco-render/logs/service.log

# Últimas 100 líneas
journalctl -u malinalco-render -n 100
```

## Mantenimiento

### Actualizar el código

```bash
cd /home/spaces/malinalco-render
git pull
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

rm -rf /home/spaces/malinalco-render
```

## Resolución de problemas

### Servicio no arranca

```bash
sudo systemctl status malinalco-render
journalctl -u malinalco-render -n 50
```

Causas frecuentes:
- `.env` no existe o falta `UBIDOTS_TOKEN`: `ls -la /home/spaces/malinalco-render/.env`
- Puerto 5000 ocupado: `sudo lsof -i:5000`
- Permisos incorrectos: `sudo chown -R spaces:spaces /home/spaces/malinalco-render`
- Node.js no encontrado: verificar que `which node` devuelve `/usr/bin/node`

### No se puede acceder desde la red

1. Verificar que el servicio está corriendo: `curl http://localhost:5000/api/health`
2. Verificar que `WEB_HOST=0.0.0.0` en `.env` (no `127.0.0.1`)
3. Verificar el firewall de la Pi: `sudo ufw status` — si está activo, abrir el puerto:
   ```bash
   sudo ufw allow 5000/tcp
   ```
4. Verificar la IP de la Pi: `hostname -I`

### MQTT no conecta

- Comprueba salida a Internet: `ping industrial.api.ubidots.com`
- Verifica TLS: `openssl s_client -connect industrial.api.ubidots.com:8883 -quiet`
- Revisa que `MQTT_PORT=8883` en `.env`
- Ver detalles en [`mqtt.md`](mqtt.md)
