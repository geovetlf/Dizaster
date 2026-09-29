# ADR 0043 — Feed de un evento

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint §5.3, §6.3 (`/v1/events/{id}/posts`)

## Contexto
La pantalla de un evento mostraba ficha, verificación, media y cronología, pero no los reportes ni las
publicaciones sobre él: para ver qué dice la gente había que buscarlo en el feed general.

## Decisión
- `GET /v1/events/:id/posts`: posts públicos y visibles ligados al evento (`social.post_event_links`, incluidos los
  que llegaron por fusión), por recientes y con el mismo cursor, bloqueos y reacciones que el resto de feeds. Un
  evento oculto responde 404.
- La app muestra la ficha del evento como cabecera y el feed debajo, con paginación. La cronología en la cabecera
  muestra las 12 entradas más recientes.
- Orden cronológico, no por relevancia: en un evento en curso lo último suele ser lo más útil.

## Consecuencias
- Los reportes seudónimos aparecen como en cualquier feed, sin autoría.
