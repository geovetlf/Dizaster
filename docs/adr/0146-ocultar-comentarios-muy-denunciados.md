# ADR 0146 — Comentarios muy denunciados se ocultan hasta revisión

- Estado: aceptada (2026-09-29, decisión del propietario, opción A; pendiente desde ADR 0020)
- AI_REQUIRED: no · COST: ninguno

## Decisión

- La regla de los posts (ADR 0020/0023) se extiende a comentarios: con `AUTO_LIMIT_FLAGGERS` (5) denuncias de
  personas distintas con peso ≥ 1 (establecidas; las cuentas nuevas o con mal historial no cuentan), el comentario
  pasa a HIDDEN hasta la revisión. Un comentario no tiene estado "limitado".
- Queda como acción `HIDE` con actor `RULE`: aparece en el caso, en "mis avisos" (con push, ADR 0141), cuenta en el
  informe de transparencia y se puede apelar. Restaurar lo devuelve.
