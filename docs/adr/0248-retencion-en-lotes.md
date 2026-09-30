# ADR 0248 — Retención de crudos y originales en lotes, y purga de corridas

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ahorro de almacenamiento

## Contexto

La retención diaria borraba como máximo 500 crudos de fuentes y 500 originales de media. USGS devuelve un cuerpo
nuevo cada minuto (cambia `metadata.generated`), unos 720 crudos al día: lo pendiente crecía sin límite (§12 costo,
§13.2 originales solo por tiempo limitado). `ingestion.runs` no se purgaba nunca.

## Decisión

- Crudos y originales se borran en lotes de 500 hasta vaciar lo vencido, con un tope de 5 minutos por pasada. Si un
  lote de crudos no logra borrar nada (almacenamiento caído), la pasada termina y se reintenta al día siguiente.
- Las corridas de ingesta sin crudo de más de 90 días se borran (`RUNS_RETENTION_DAYS`).

## Consecuencias

- El almacenamiento no crece con el tiempo por fuentes muy frecuentes. Prueba en `source-raw.test.ts`.
