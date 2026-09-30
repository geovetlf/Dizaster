# ADR 0226 — Feed "Siguiendo" indexable y acotado a 30 días

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno (menos CPU de base de datos)

## Contexto

El filtro de "Siguiendo" comparaba `p.author_id::text IN (…)` y `le.event_id::text IN (…)` sin ventana de tiempo.
El cast impide usar los índices por autor y por evento, así que PostgreSQL recorría el índice general del feed
filtrando fila por fila. Para alguien que sigue pocas cuentas poco activas, eso podía recorrer toda la tabla de posts
en cada página.

## Decisión

- Se comparan uuid con uuid (`target_id::uuid` en la subconsulta de seguimientos), lo que permite usar
  `posts_author_public_idx` y `post_event_links_event_idx`.
- "Siguiendo" muestra los últimos 30 días (`FOLLOWING_WINDOW_DAYS`), como "Para ti". Lo anterior sigue disponible en
  el perfil, el evento, el lugar o la etiqueta.

## Consecuencias

- El costo de cada página queda acotado aunque la tabla crezca.
- Prueba en `following-window.test.ts`.
