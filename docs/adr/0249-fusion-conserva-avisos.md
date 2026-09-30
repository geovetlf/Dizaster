# ADR 0249 — Fusionar eventos conserva el historial de avisos

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

Al fusionar un evento en otro (§5.7), las alertas no lo sabían. Quien fue avisado del evento absorbido no recibía
el "confirmado", "falso" o "terminado" del que quedó, y el que quedó podía volver a anunciarse como nuevo para el
mismo incidente (§5.10, fatiga).

## Decisión

- `EventService.mergedIdsOf(target)`: los eventos absorbidos (también en cadena). Como se lee en cada evaluación,
  deshacer una fusión lo deja al día solo.
- Al evaluar un evento, si ya se avisó de alguno de sus absorbidos, no se anuncia como nuevo.
- "Ya avisado" (PREVIOUSLY_ALERTED) incluye a quien recibió avisos de los absorbidos, también para las
  actualizaciones oficiales (ADR 0157).

## Consecuencias

- Un incidente fusionado se sigue como uno solo. Prueba en `alert-merge.test.ts`.
