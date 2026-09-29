# ADR 0147 — Notas de moderación en la línea de tiempo del evento

- Estado: aceptada (2026-09-29, decisión del propietario, opción A: visibles solo para moderación)
- AI_REQUIRED: no · COST: ninguno · PRIVACY_IMPACT: ninguno público (las notas nunca salen por la API pública)

## Decisión

- `POST /v1/moderation/events/:id/notes` (permiso `event.verify`: verificación, moderación y administración) agrega
  una entrada `MODERATOR_NOTE` (§7.3) con visibilidad `INTERNAL` en `event.timeline`, con el texto y quién la
  escribió. La timeline pública ya filtraba `visibility = 'PUBLIC'`; un test lo comprueba.
- `ModeratorEventDetail.notes` las devuelve (las 100 más recientes). No se editan ni se borran.
- La pantalla de herramientas del evento en la app tiene una sección "Notas internas" con su propio campo.
