# ADR 0108 — El testimonio tardío pesa menos (presence-3)

Estado: aceptada (2026-09-29)

## Contexto
§8.3 del Blueprint: un reporte capturado sin conexión que llega fuera de la tolerancia de su categoría se acepta como
**testimonio tardío**, "evidencia de menor peso, sin crear pin nuevo". Ya no creaba evento (`mayCreateEvent`), pero
su puntuación de presencia era la misma que la de un envío a tiempo y, con banda HIGH, contaba como corroboración
independiente.

## Decisión
- Reglas de presencia **presence-3** = presence-2 + `lateOfflineFactor: 0.5`. Si `lateOffline`, la puntuación se
  multiplica por el factor y se limita por debajo del umbral HIGH. Como la corroboración independiente solo cuenta
  presencia HIGH, un testimonio tardío se suma al evento como evidencia visible pero no lo verifica.
- `score_breakdown.lateOfflineFactor` queda guardado para auditoría y explicación.
- Las reglas presence-1 y presence-2 no descuentan: un reporte puntuado con ellas sigue siendo reproducible.
- NO AI REQUIRED.

## Consecuencias
- Un reporte offline dentro de la tolerancia no cambia. El factor es configuración versionada: cambiarlo exige
  presence-4.
