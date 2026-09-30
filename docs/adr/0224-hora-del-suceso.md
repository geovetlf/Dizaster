# ADR 0224 — Hora del suceso además de la hora de detección

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

§7.3 define `occurred_start` (cuándo pasó) y el servidor ya lo guardaba: la hora de origen que da la fuente, o la
captura del primer reporte. La API solo exponía `firstSeenAt` (cuándo lo supo Dizaster). Con fuentes que publican
tarde, como los informes de ReliefWeb o de la OMS, la hora mostrada podía ser horas o días posterior al suceso.

## Decisión

- `EventSummary.startedAt` (opcional, compatible con cachés viejas) expone `occurred_start`.
- La app muestra la hora del suceso. Si Dizaster lo supo 15 minutos o más después, muestra ambas: "Ocurrió 08:00 ·
  informado 11:30". Si la hora del suceso falta o es posterior a la detección, usa la de detección.

## Consecuencias

- La línea de tiempo pública dice cuándo pasó algo, no solo cuándo llegó el dato.
- Pruebas en `event-started.test.ts` (servidor) y `event-status.test.ts` (app).
