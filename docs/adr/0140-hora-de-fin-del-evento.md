# ADR 0140 — Hora de fin del evento

- Estado: aceptada (2026-09-29) · AI_REQUIRED: no · COST: ninguno · PRIVACY_IMPACT: ninguno

## Contexto

§7.3 define `Event.occurred_end`; la columna existía desde 0001 pero nadie la escribía.

## Decisión

- La mantiene el trigger de `resolved_at` (0064), que cubre todas las rutas: inactividad, moderación y fin oficial.
  - Al pasar a RESOLVED: si nadie fijó una hora, se usa la última actividad (nunca una hora futura).
  - El fin oficial (ADR 0059) fija la última hora de retiro o expiración que dieron las fuentes.
  - Al reactivarse (ACTIVE / MONITORING) se borra. Archivar la conserva.
- `EventSummary.endedAt` (opcional y nulo en eventos abiertos). La ficha del evento muestra "Terminó …" con la misma
  doble zona horaria que el inicio.
- Los eventos ya cerrados se completan en la migración con su última actividad.
