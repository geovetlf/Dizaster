# ADR 0116 — La cola de moderación también prioriza por verificación

Estado: aceptada (2026-09-29)

## Decisión
§13.3: "cola priorizada por severidad × alcance × verificación". `verificationPriority(estado, alcance)` suma a la
prioridad del caso el peso del estado público del evento vinculado (FALSE y DISPUTED 3, UNVERIFIED 2,
COMMUNITY_CORROBORATED 1, EXTERNALLY_CORROBORATED 0, OFFICIALLY_CONFIRMED −1), multiplicado por el alcance del post
(`max(1, log10(1 + alcance))`). La prioridad nunca queda negativa. Pura y determinista. NO AI REQUIRED.

## Consecuencias
- Un post muy leído sobre un evento en disputa sube en la cola; uno sobre un evento confirmado oficialmente baja.
