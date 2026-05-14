# MQTT y Ubidots

## Protocolo

El sistema usa **MQTT 3.1.1 sobre TLS** (MQTTS) para recibir datos de Ubidots Industrial.

| Parámetro | Valor |
|---|---|
| Broker | `industrial.api.ubidots.com` |
| Puerto | `8883` (TLS) |
| Protocolo | MQTT 3.1.1 |
| Autenticación | `username = UBIDOTS_TOKEN`, `password = ""` |
| Dirección | Subscribe-only (el backend nunca publica) |
| Reconexión | Automática cada 1 s |
| Keepalive | 60 s |
| Connect timeout | 30 s |

> **Puerto 8883 obligatorio para Ubidots Industrial.** El puerto 1883 (sin TLS) no es aceptado por el broker de Ubidots.

## Tópico suscrito

```
/v1.6/devices/{UBIDOTS_DEVICE}/+/lv
```

El wildcard `+` captura **todas las variables** del device. El sufijo `/lv` es el endpoint *last value* de Ubidots — el broker publica el valor más reciente cada vez que el sensor envía una lectura.

Ejemplo con device `prueba_lora`:
```
/v1.6/devices/prueba_lora/sfth3_temperature/lv
/v1.6/devices/prueba_lora/sfth3_humidity/lv
/v1.6/devices/prueba_lora/sith4_temperature/lv
...
```

## Formato de payload

Los payloads de Ubidots `/lv` son **cadenas numéricas planas**, no JSON:

```
25.4
```

No hay envolvente `{"value": ...}`. El parser en `parseLvMessage()` hace `Number(str)` directamente.

## Variables registradas

Las variables se definen en `src/sensorsMap.js`. Cada sensor físico tiene una variable de temperatura y una de humedad:

| Sensor ID | Zona | Variable temperatura | Variable humedad |
|---|---|---|---|
| `eng_c` | engorda | `sith3_temperature` | `sith3_humidity` |
| `eng_n` | engorda | `sfth3_temperature` | `sfth3_humidity` |
| `eng_d` | engorda | `sfth4_temperature` | `sfth4_humidity` |
| `dev_c` | desarrollo | `sico2_temperature` | `sico2_humidity` |
| `hab1_n` | hab1 | `sith5_temperature` | `sith5_humidity` |
| `hab1_s` | hab1 | `sfth2_temperature` | `sfth2_humidity` |
| `hab2_n` | hab2 | `sfth1_temperature` | `sfth1_humidity` |
| `hab2_s` | hab2 | `sith4_temperature` | `sith4_humidity` |

Solo las variables listadas en `VALID_KEYS` son procesadas. Las demás se descartan silenciosamente.

## Validación de lecturas

Antes de persistir un valor, `isValidReading()` verifica rangos físicos:

| Magnitud | Mínimo | Máximo |
|---|---|---|
| Temperatura | -10 °C | 80 °C |
| Humedad | 0 % | 100 % |

Valores fuera de rango se loguean como `warn` y se ignoran — el store conserva el último valor válido.

## Flujo de un mensaje MQTT

```
Broker publica:
  topic:   /v1.6/devices/prueba_lora/sfth3_temperature/lv
  payload: "21.6"

parseLvMessage(topic, payload)
  → device   = "prueba_lora"
  → variable = "sfth3_temperature"
  → value    = 21.6

VALID_KEYS.has("prueba_lora/sfth3_temperature") → true

isValidReading("sfth3_temperature", 21.6) → true (rango -10..80)

resolveVariable("sfth3_temperature")
  → { sensor: eng_n, mode: "temp" }

logger.info("Received engorda.temp=21.6 (sfth3_temperature)")

store.update("prueba_lora", "sfth3_temperature", 21.6)
  → emite 'change'
  → sseHub.broadcast('snapshot', store.getAll())
  → sseHub.broadcast('data', { ..., sensorId: "eng_n", zone: "engorda", mode: "temp" })
```

## Modo mock (sin MQTT)

Cuando `MOCK_DATA=true`, `mockDriver.js` omite la conexión MQTT y llama directamente a `store.update()` con valores aleatorios cada 2 s. El indicador de conexión en el frontend reporta **Conectado** (el mock siempre retorna `true` en `mqttStatusFn`).

```env
MOCK_DATA=true
```

Útil para:
- Desarrollo sin acceso a la red del sensor
- Pruebas de UI y animaciones
- Demostración del dashboard sin datos reales

## Diagnóstico de problemas MQTT

### El indicador muestra "Desconectado"

1. Verificar que `UBIDOTS_TOKEN` en `.env` es válido (empieza con `BBUS-`)
2. Verificar que `MQTT_PORT=8883` (no 1883)
3. Verificar conectividad al broker:
   ```bash
   # Requiere openssl
   openssl s_client -connect industrial.api.ubidots.com:8883 -quiet
   ```
4. Revisar logs:
   ```bash
   # El error típico de token inválido:
   # [WARN] mqttClient: MQTT error: Connection refused: Bad username or password
   ```

### No llegan datos (indicador verde pero sin lecturas)

1. Verificar que `UBIDOTS_DEVICE` coincide exactamente con el label del device en Ubidots
2. Verificar en Ubidots que las variables del device reciben datos recientemente
3. Revisar que los nombres de variables en `sensorsMap.js` coinciden con los labels en Ubidots

### Lecturas rechazadas

Si aparece en logs `Rejected {variable}={value}: outside valid range`, el sensor está enviando un valor fuera del rango físico configurado. Revisar `TEMP_VALID_MIN/MAX` en `config.js` si el rango legítimo del sensor lo excede.
