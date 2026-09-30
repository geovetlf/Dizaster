# ADR 0239 — Registro de moderación por moderador y accesos a originales paginados

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

`moderation.actions.moderator_user_id` se guardaba, pero nada lo mostraba: administración no podía ver qué acciones
tomó cada moderador (§5.21, §13.1). El registro de accesos a originales devolvía solo los 100 últimos, sin filtros.

## Decisión

- `GET /v1/admin/moderation-actions?moderator=@handle&cursor=&limit≤200`, solo administración: acciones más
  recientes primero con el handle de quien moderó (o automática). Nueva pantalla "Registro de moderación" en la app.
- `GET /v1/admin/media-original-access` acepta `mediaId`, `actorUserId`, `cursor` y `limit≤200`, y devuelve
  `nextCursor`.
- Los handles de listas de administración (personal, historial de configuración y este registro) se leen en una
  sola consulta (`handlesForUsers`), en vez de una por persona.

## Consecuencias

- Cada acción de moderación es atribuible y consultable. Pruebas en `moderation-action-log.test.ts`,
  `media.test.ts` y `moderation-log.test.ts` (app).
