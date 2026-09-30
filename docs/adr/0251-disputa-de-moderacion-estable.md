# ADR 0251 — Las reglas no deshacen una disputa decidida por moderación

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

`moderatorSetNegative` cambiaba el estado negativo sin guardar de dónde venía. Con la siguiente evidencia (un
reporte, una retirada, una fusión) el motor lo recalculaba: un DISPUTED puesto por moderación sin contra-reportes
volvía a NONE (0 ≥ 0), y una disputa quitada por moderación volvía a aparecer. Contradice ADR 0115 y §10.1–10.2.

## Decisión

- Migración 0099: `verification.state.negative_source` (RULE o MODERATOR). Moderación escribe MODERATOR; el motor
  escribe RULE cuando él cambia el estado. Los estados actuales cuya última transición negativa fue de moderación
  quedan como MODERATOR.
- Con MODERATOR, el motor mantiene el estado. Solo lo cambian un desmentido oficial (FALSE), una confirmación oficial
  (NONE, ADR 0005) o moderación de nuevo.

## Consecuencias

- Las decisiones de moderación son estables y auditables. Prueba en `moderator-negative-sticky.test.ts`.
