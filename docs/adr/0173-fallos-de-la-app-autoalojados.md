# ADR 0173 — Fallos de la app autoalojados

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno (misma API y misma base)

## Contexto

§5.22 pide informes de fallos de la app. ADR 0161 los guardaba solo en el teléfono porque el proveedor externo
(Sentry) espera un DSN del propietario. Sin datos en el servidor, operación no ve los fallos reales.

## Decisión

- `POST /v1/client-crashes` sin sesión: hasta 20 entradas ya redactadas por la app (ADR 0161: sin tokens, correos,
  coordenadas ni UUID) con mensaje, lugar, pila recortada e id de la petición fallida (ADR 0172). Plataforma y versión
  salen de las cabeceras de ADR 0164 y se descartan si no son válidas.
- `platform.client_crashes` (migración 0080) no guarda cuenta ni IP. Huella = SHA-256 de mensaje + primer marco con
  los números normalizados, para agrupar el mismo fallo entre versiones. El cupo general por IP limita el abuso.
- Retención: `CLIENT_CRASH_RETENTION_DAYS` (30 por defecto) en la tarea diaria del worker.
- `GET /v1/admin/client-crashes?days=` (ops.view) agrupa por huella; pantalla "Fallos de la app" en el perfil de
  operación, con periodos 24 h / 7 d / 30 d.
- App: `recordError` guarda y luego envía lo pendiente; al abrir la app se reintenta. Lo enviado queda marcado en el
  registro local, que sigue visible en "Acerca de".

## Consecuencias

- Si el propietario entrega el DSN de Sentry, puede sumarse detrás del mismo `setCrashSender`; esto no lo sustituye.
- No hay símbolos (source maps): la pila es del bundle. Cargar source maps al servidor queda para cuando haga falta.
