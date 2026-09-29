# ADR 0015 — Feed y red social (primer corte)

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint §7 (Social), ADR 0003

## Decisión
- `GET /v1/feed` con pestañas `for_you` (recientes), `nearby` (25 km sobre la ubicación pública ya generalizada),
  `videos` y `following` (vacío hasta que exista seguir). Filtro por categoría raíz u hoja. Paginación por cursor.
- La app envía la ubicación del lector redondeada a 2 decimales (~1 km) y la respuesta da la distancia por tramos.
- `FeedService` compone social (posts), event (estado de verificación) y media (variantes saneadas) sin que ningún
  módulo lea el esquema de otro. La media de categorías sensibles solo aparece aprobada por moderación.
- Los posts guardan su categoría (`social.posts.category_code`) y el tipo de cada media adjunta (`social.post_media.kind`).
- Me gusta idempotente; comentarios con límite de 10 por minuto por perfil. Solo posts visibles.
- Los posts seudónimos nunca exponen autor en el feed.

## Pendiente
Ranking de "para ti", seguir perfiles, índice de lugares (nombres de distrito), denuncias de contenido.
