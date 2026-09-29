# ADR 0106 — Paginación por cursor de timeline y comentarios

Estado: aceptada (2026-09-29)

## Contexto
§6.3 y §13.1 del Blueprint piden respuestas acotadas y paginadas. La timeline de un evento se devolvía entera y los
comentarios se cortaban en 200 sin forma de ver el resto.

## Decisión
- Contrato `ChronoPageQuery { cursor?: uuid, limit 1–200 (200 por defecto), order asc|desc (asc por defecto) }`
  para `GET /v1/events/:id/timeline` y `GET /v1/posts/:id/comments`. Las respuestas añaden `nextCursor`.
- Paginación por clave: el cursor es el id del último elemento recibido y el servidor compara `(at, id)` /
  `(created_at, id)` con la fila real, así no hay pérdida de precisión ni saltos con horas empatadas. Un cursor que
  no pertenece al evento o al post da 400. Usa los índices existentes (`event_id, at`) y (`post_id, created_at`).
- Sin parámetros, la respuesta es igual que antes (hasta 200, de lo más antiguo a lo más nuevo): compatible con
  versiones anteriores de la app.
- La ruta de media del evento sigue leyendo la timeline completa internamente.
- App: la ficha pide la timeline `desc` de 12 en 12 con "Ver anteriores"; los comentarios llegan de 50 en 50 al
  acercarse al final de la lista. `appendPage` evita duplicados (un comentario propio recién publicado) y
  `newestFirst` ordena también copias guardadas sin conexión con el formato antiguo. NO AI REQUIRED.

## Consecuencias
- Publicar un comentario ya no depende de que quepa entre los 200 primeros para devolverse.
