# ADR 0150 — La prioridad de los casos de moderación se mantiene al día

- Estado: aceptada (2026-09-29) · AI_REQUIRED: no · COST: ninguno (una consulta por caso abierto cada hora)

## Contexto

La prioridad de un caso (ADR 0020, 0116) suma motivos, alcance, gravedad y verificación del evento vinculado, pero
solo se calculaba al entrar una denuncia. Un post denunciado cuyo evento pasa a DISPUTED, o que se vuelve viral
después de la denuncia, quedaba abajo en la cola con una prioridad vieja.

## Decisión

- `ModerationService` consume `VerificationChanged` y `EventLifecycleChanged`: recalcula los casos ABIERTOS sobre ese
  evento y sobre los posts vinculados a él (`social.postsLinkedToEvent`, respeta los límites de módulo).
- `refreshPriorities()` recalcula todos los casos abiertos por lotes; el worker lo llama cada hora (el alcance crece
  sin evento de dominio).
- Misma fórmula que antes; solo cambia cuándo se aplica.
