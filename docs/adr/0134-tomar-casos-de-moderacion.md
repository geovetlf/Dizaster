# ADR 0134 — Tomar casos de moderación

Estado: aceptada (2026-09-29)

## Contexto
§7.3 lista "ModerationCase … assignee". La cola se ordenaba solo por prioridad (ADR 0116): dos personas podían abrir
el mismo caso y actuar a la vez.

## Decisión
- Tomar un caso (`POST /v1/moderation/cases/:id/claim`) lo reserva 15 min (`CASE_CLAIM_MINUTES`), renovable por
  quien lo tiene; `DELETE` lo suelta (solo quien lo tiene). Columnas `claimed_by`, `claimed_until` (migración 0059).
- Mientras está tomado y sin vencer, no aparece en la cola de las demás personas y nadie más puede actuar sobre él
  (409 `CASE_CLAIMED`). Vence solo: si alguien se va, el caso vuelve a la cola sin intervención.
- Cerrar el caso lo suelta. La vista del caso dice si está tomado y si es por mí, nunca por quién.
- App: al abrir un caso se toma; si otra persona lo tiene, se ve con el aviso "Otra persona está revisando este
  caso"; al salir se suelta.
- NO AI REQUIRED; costo cero.
