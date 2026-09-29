# ADR 0143 — Reportes ocultos o retirados por moderación dejan de contar

- Estado: aceptada (2026-09-29, decisión del propietario, opción A) · AI_REQUIRED: no · COST: ninguno

## Contexto

§6.2 pide que Event y Report consuman `ModerationActionTaken`. Hasta ahora, ocultar o retirar el post de un reporte
solo cambiaba el post: su evidencia seguía contando para corroboración, geometría y contadores.

## Decisión

- HIDE y REMOVE sobre el post de un reporte pasan su evidencia a `MODERATED` (deja de contar); RESTORE la devuelve a
  `ACTIVE`. LIMIT no cambia nada (solo reduce alcance). Suspender una cuenta no aparta sus reportes por sí solo.
- Se recalculan agregados y la verificación se reevalúa (`EventEvidenceAdded`), igual que con un retiro propio.
- Un evento que se queda sin evidencia activa se oculta; `event.events.hidden_from` guarda su estado de publicación
  y, si la evidencia vuelve, lo recupera (y avisa `EventPublished` si estaba publicado).
- Un reporte retirado por su autor queda `DETACHED` aunque moderación lo hubiera apartado: Restaurar no lo revive.
- Timeline pública: "Moderación apartó un reporte" / "Moderación restauró un reporte", sin decir cuál ni por qué.
