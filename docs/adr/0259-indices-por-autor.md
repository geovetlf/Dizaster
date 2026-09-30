# ADR 0259 — Índices por autor en comentarios y reacciones

Fecha: 2026-09-30 · Estado: aceptada · NO AI REQUIRED

## Contexto
El cupo de comentarios por minuto cuenta los comentarios recientes del autor en cada comentario nuevo, y el borrado de
cuenta y la exportación filtran comentarios y reacciones por persona (§7.4). El único índice con `author_profile_id`
era parcial (`client_id IS NOT NULL`), y las reacciones solo tenían su clave primaria por post: cada una de esas
consultas recorría toda la tabla.

## Decisión
Migración 0101: `comments (author_profile_id, created_at DESC)`, `reactions (profile_id)` y
`comment_reactions (profile_id)`. Menciones y compartidos externos ya tenían índice por persona.

## Consecuencias
- `test/author-indexes.test.ts` comprueba con `EXPLAIN` que esas consultas usan los índices.
