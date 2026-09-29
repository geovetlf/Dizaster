# ADR 0052 — Contrato OpenAPI y trazas OpenTelemetry

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint §4.3 (REST + OpenAPI), §5.22 (OpenTelemetry)

## OpenAPI
- `GET /v1/openapi.json` (OpenAPI 3.1) se genera desde los esquemas zod de `@dizaster/contracts` con
  `z.toJSONSchema`: la misma fuente valida en el servidor y tipa la app, así que el contrato no se desincroniza.
- `src/http/openapi.ts` tiene una entrada por ruta (resumen, cuerpo, query y respuesta cuando existe esquema zod).
  Las rutas se recogen al registrarse (`onRoute`); una prueba falla si hay una ruta sin documentar o una
  documentada que no existe. Sesión: lecturas públicas salvo `/v1/me`, `/v1/admin`, `/v1/moderation`; escrituras
  con sesión salvo iniciarla.
- Donde la respuesta es solo un tipo TypeScript, la operación va sin esquema de respuesta. Convertir esos tipos a
  zod es trabajo incremental, no bloqueante. El almacenamiento local de desarrollo no forma parte del contrato.

## OpenTelemetry
- `src/telemetry.ts` se carga antes que la app (`node --import ./dist/telemetry.js …`, en la imagen, `start`,
  `worker` y docker-compose). Sin `OTEL_EXPORTER_OTLP_ENDPOINT` no hace nada: cero costo y cero dependencias cargadas.
- Con endpoint: trazas OTLP/HTTP (cualquier colector: Grafana Alloy/Tempo autoalojado o capa gratuita), muestreo
  10 % por defecto que respeta al padre, e instrumentación de HTTP, Fastify (por ruta) y PostgreSQL.
- Privacidad: sin cuerpos ni cabeceras, sin valores de parámetros SQL y sin query string en ninguna traza (llevan
  coordenadas y búsquedas). Probado de punta a punta con un receptor OTLP local.
- Las métricas de costo y calidad siguen en el `Meter` propio (ADR anteriores); exportarlas por OTLP es posible
  más adelante sin cambiar los módulos. Crashes móviles (Sentry) siguen pendientes de la cuenta del propietario.
