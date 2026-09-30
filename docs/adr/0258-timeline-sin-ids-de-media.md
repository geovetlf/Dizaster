# ADR 0258 — La línea de tiempo pública no expone ids de media

Fecha: 2026-09-30 · Estado: aceptada · NO AI REQUIRED

## Contexto
La entrada `MEDIA_ADDED` de `GET /v1/events/:id/timeline` devolvía `mediaIds`. La URL pública de una foto se arma solo
con su id (`public/<id>.jpg`), así que la timeline permitía ver fotos que la galería filtra: pendientes de aprobación en
categorías sensibles (ADR 0035), de reportes ocultos o retirados por moderación (ADR 0203) o de posts con retraso (§13.3, §5.9).
La app no usa ese campo.

## Decisión
- `publicEntry` quita `mediaIds` además de `reportId` y `viaMerge`; la entrada conserva `mediaCount`.
- La galería del evento sigue siendo la única vía pública a la media, con sus filtros.
- No se borran los archivos públicos al retirar un post: retirar es reversible (Restaurar). Queda como mejora posible
  cambiar la clave pública por una no derivable del id.

## Consecuencias
- Prueba en `services/core/test/media.test.ts`.
