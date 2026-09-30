# ADR 0203 — Galería del evento sin fotos de reportes moderados, y por páginas

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno (menos lectura por petición)

## Contexto

§13.3 y §7.1: ocultar o retirar un reporte por moderación (ADR 0143) deja de contarlo para el evento, pero
`GET /v1/events/:id/media` armaba la galería con todas las entradas `MEDIA_ADDED` de la timeline, sin mirar el estado
del reporte: las fotos de un reporte oculto se seguían sirviendo. Además leía la timeline entera en cada llamada
(§13.1 pide paginación).

## Decisión

- `EventService.galleryPage` lee solo entradas `MEDIA_ADDED`, por páginas (`cursor` = id de la última entrada,
  comparado por `(at, id)` como ADR 0106; `limit` 1–50, por defecto 20) y excluye las de reportes cuya evidencia está
  `MODERATED` (oculto o retirado por moderación) o `DETACHED` (retirado por su autor). Restaurar devuelve las fotos
  sin tocar la media: el filtro se evalúa en cada lectura.
- La respuesta añade `nextCursor`. La app muestra "Ver más fotos" al final de la tira y solo pide la página siguiente
  si la persona la toca (ahorra datos).
- Un cursor que no es una entrada de media de ese evento da 400.

## Consecuencias

- Lo que la moderación oculta desaparece también de la galería pública, sin borrar nada (reversible).
- Apps antiguas sin paginación ven la primera página (hasta 20 reportes con fotos), sin romperse.
