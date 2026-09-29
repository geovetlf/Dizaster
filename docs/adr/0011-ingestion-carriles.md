# ADR 0011 — Ingestión: carriles NORMAL/URGENT, adapters por formato y circuit breaker

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint §9

## Decisión
- Adapters puros por formato (`usgs-geojson`, `gdacs-rss`): transforman texto en `NormalizedItem` sin red ni base de datos; se prueban con archivos de ejemplo. Cada adapter define qué es urgente (USGS: M ≥ 4,5 o aviso de tsunami; GDACS: alerta naranja o roja).
- `IngestionScheduler.tick()` (worker, cada 30 s):
  - URGENT: fuentes `urgent_capable`, cada `urgent_poll_seconds`; solo ingiere ítems urgentes. Va siempre primero.
  - NORMAL: una ejecución por horario (`schedule_normal`, subconjunto de cron en UTC; por defecto 05:00); ingiere todo.
  - Peticiones condicionales (ETag / If-Modified-Since) con validadores **separados por carril**, para que el sondeo urgente no oculte cambios al carril normal.
  - Circuit breaker: 3 fallos seguidos abren la fuente 5 min, duplicando hasta 6 h; un éxito lo cierra.
  - Cada ejecución queda en `ingestion.runs` (observabilidad y costo).
- Solo se consultan fuentes `ACTIVE`. USGS se activa (dominio público); GDACS queda `PLANNED` hasta revisar sus términos; las fuentes peruanas siguen en investigación.
- Los adapters se validaron con archivos de ejemplo construidos según el formato documentado: la red de este entorno bloquea las fuentes. Antes de producción hay que contrastarlos con los feeds reales.
