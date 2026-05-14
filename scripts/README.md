# Scripts de instalación — Malinalco Render

Scripts para instalar el dashboard como servicio Windows con arranque automático y Chrome en modo kiosko.

> **Para Raspberry Pi / Linux**, ver [`docs/raspberry-pi.md`](../docs/raspberry-pi.md).

---

## Prerequisitos

| Requisito | Versión mínima | Descarga |
|---|---|---|
| **Node.js** | 20 LTS | https://nodejs.org/ |
| **NSSM** | cualquiera | https://nssm.cc/download |
| **Google Chrome** | cualquiera | https://www.google.com/chrome/ |

### Instalar NSSM

1. Descarga el `.zip` desde https://nssm.cc/download
2. Extrae el ejecutable `nssm.exe` (carpeta `win64/`)
3. Cópialo a `C:\Windows\System32\`
4. Verifica en una terminal: `nssm version`

---

## Paso 1 — Limpiar instalaciones anteriores

Si el equipo tuvo previamente un servicio `TenebrioHeatmap` o `TenebrioNode`:

```bat
scripts\remove_old_service.bat
```

Si es un equipo limpio, salta este paso.

## Paso 2 — Configurar el proyecto

Desde la raíz `malinalco-render/`:

```bat
copy .env.example .env
```

Edita `.env` con tu token Ubidots:

```env
UBIDOTS_TOKEN=BBUS-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
UBIDOTS_DEVICE=nombre-del-device
MQTT_BROKER=industrial.api.ubidots.com
MQTT_PORT=8883
WEB_PORT=5000
```

## Paso 3 — Instalar dependencias npm

```bat
scripts\setup.bat
```

## Paso 4 — Instalar el servicio Windows

Ejecuta como **administrador**:

```bat
scripts\install_service.bat
```

El script automatiza:

1. Verifica permisos, NSSM y Node.js
2. Crea la carpeta `logs/`
3. Instala el servicio Windows `MalinalcoNode` (arranque automático)
4. Configura logs en `logs/service.log` con reinicio automático ante fallos
5. Inicia el servicio
6. Copia `open_kiosk.bat` a la carpeta Startup del usuario (`MalinalcoKiosk.bat`)
7. Abre Chrome en kiosko apuntando a `http://localhost:5000`

Al terminar, el equipo queda configurado para:
- Iniciar el servidor automáticamente al encender
- Abrir Chrome en pantalla completa al iniciar sesión

---

## Mantenimiento

### Actualizar dependencias y reiniciar servicio

```bat
scripts\update_service.bat
```

Detiene el servicio, ejecuta `npm install` y lo reinicia.

### Desinstalar todo

```bat
scripts\uninstall_service.bat
```

Elimina el servicio, cierra el kiosko, borra la entrada de Startup y restaura la barra de tareas.

---

## Comandos NSSM útiles

Desde cualquier terminal con privilegios de administrador:

```bat
nssm status MalinalcoNode       :: Ver estado del servicio
nssm start  MalinalcoNode       :: Iniciar
nssm stop   MalinalcoNode       :: Detener
nssm restart MalinalcoNode      :: Reiniciar
```

Logs del servidor:

```
malinalco-render\logs\service.log
```

---

## Estructura de scripts

```
scripts/
├── install_service.bat     Instala el servicio Node + kiosko
├── update_service.bat      npm install + reinicio del servicio
├── uninstall_service.bat   Desinstala todo, restaura el sistema
├── remove_old_service.bat  Elimina servicios anteriores (TenebrioHeatmap / TenebrioNode)
├── open_kiosk.bat          Abre Chrome en kiosko (copiado a Startup)
├── setup.bat               Instala dependencias npm (Windows)
└── setup.sh                Instala dependencias npm (Linux / Raspberry Pi)
```

---

## Resolución de problemas

**El servicio no arranca**
- Revisa `malinalco-render\logs\service.log`
- Verifica que `.env` existe y tiene `UBIDOTS_TOKEN`
- Comprueba que el puerto 5000 está libre: `netstat -ano | findstr :5000`

**Chrome no abre en kiosko al iniciar sesión**
- Verifica que `MalinalcoKiosk.bat` existe en `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\`
- Si no está, vuelve a ejecutar `install_service.bat` como administrador

**La barra de tareas sigue oculta tras desinstalar**
- Ejecuta `uninstall_service.bat` como administrador — el paso 6 la restaura
- O manualmente: clic derecho en la barra de tareas → Configuración → desactivar "Ocultar automáticamente la barra de tareas"

**MQTT no conecta (indicador rojo)**
- Verifica `MQTT_PORT=8883` (no 1883) en `.env` — Ubidots Industrial requiere TLS
- Ver detalles en [`docs/mqtt.md`](../docs/mqtt.md)
