# ADR 0064: AI CORE opcional, conectores reemplazables y modo costo cero

- Estado: aceptada (mensaje del propietario "Zero/minimum AI cost architecture", 2026-09-29)

## Contexto

El propietario pidió motor determinista primero (código → datos locales → OSS → PostgreSQL/PostGIS/H3 → IA → conector
comercial), una sola IA opcional y reemplazable, interfaces para conectores sin integrar APIs comerciales, y un modo de
desarrollo sin gasto.

Auditoría (2026-09-29, ver `docs/ENGINES_AND_CONNECTORS.md`): **ninguna función llama hoy a IA ni a una API
comercial.** Lo único externo es: fuentes abiertas (USGS, GDACS, CAP), push directo APNs/FCM (gratis), almacenamiento
S3-compatible (en producción) y estilo de mapa (demo, detrás de `MapProvider`). No hubo nada que mover al motor.

## Decisión

- `services/core/src/platform/connectors/`:
  - interfaces `AIProvider`, `TranslationProvider`, `SmsProvider`, `SpeechToTextProvider`, `TextToSpeechProvider`;
    cada proveedor declara `paid`. Video en vivo (`LiveStreamProvider`), mapas (`MapProvider`) y fuentes/clima
    (`FeedAdapter`) ya tenían interfaz y no se duplican;
  - implementaciones solo gratuitas: `none` (por defecto), `fixture` (IA de respuestas fijas para desarrollo y pruebas),
    `log` (SMS que no envía);
  - `buildConnectors(env, costGuard)`; con `COST_MODE=zero` (por defecto) el arranque falla si algún proveedor es de pago.
    Producción rechaza `fixture` y `log`.
- **AI CORE** (`AiCore.run(task, instrucciones, entrada)`): único punto de uso de IA.
  - Tareas en lista cerrada (`AI_TASKS`): duplicados ambiguos, triaje de texto para moderación, resumen de evento,
    traducción. Añadir una exige ADR.
  - Nunca lanza: devuelve `DISABLED | KILLED | NO_BUDGET | TIMEOUT | ERROR` y quien llama sigue con su regla.
    Un fallo de IA nunca bloquea un reporte.
  - Antes de gastar: kill switch `ai` y presupuesto (CostGuard, ADR 0019); después registra el costo real.
  - Minimiza la entrada (correos, teléfonos, coordenadas, URLs) y la recorta.
  - No decide: el resultado es una sugerencia. `recordAiSuggestion` sigue rechazando OFFICIALLY_CONFIRMED
    (`AI_CANNOT_CONFIRM`) y ninguna regla de verificación lee sugerencias.
- Una prueba de regresión falla si el código fuera de `connectors/` importa un SDK de IA/traducción/SMS o nombra sus
  hosts, o si `package.json` los añade.

## Consecuencias

- Integrar un proveedor comercial = un adaptador en `connectors/`, presupuesto aprobado, `COST_MODE=metered`. Queda
  BLOQUEADO hasta que el propietario elija proveedor y presupuesto.
- Ninguna función actual usa todavía el AI CORE: los casos ambiguos de duplicados siguen en la cola de moderación.
