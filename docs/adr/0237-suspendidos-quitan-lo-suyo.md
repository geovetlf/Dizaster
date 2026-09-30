# ADR 0237 — Una cuenta suspendida puede quitar sus comentarios y reportes

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

Una cuenta suspendida podía borrar sus posts (ADR 0225 y anteriores) pero no sus comentarios ni retirar un reporte
desde Mis reportes, aunque el mismo reporte sí se podía retirar borrando su post. Era incoherente y le impedía
quitar contenido propio mientras apelaba.

## Decisión

- `DELETE /v1/comments/:id` y `DELETE /v1/me/reports/:id` se añaden a las escrituras permitidas a una cuenta
  suspendida. Las dos solo actúan sobre contenido propio (el servicio lo comprueba). Publicar, comentar e interactuar
  siguen bloqueados.

## Consecuencias

- Quitar lo propio nunca se impide. Prueba en `suspended-own-content.test.ts`.
