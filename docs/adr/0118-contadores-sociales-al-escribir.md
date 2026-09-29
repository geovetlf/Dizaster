# ADR 0118 — Contadores sociales mantenidos al escribir

Estado: aceptada (2026-09-29)

## Contexto
§7.4: "contadores… actualizados por jobs, no con COUNT(*) en lectura". El feed contaba comentarios, compartidos y
reacciones con subconsultas por cada post leído.

## Decisión
- `social.posts.comment_count`, `share_count` y `reaction_counts` (jsonb por tipo), migración 0050 con relleno.
- Triggers `AFTER` en `social.comments`, `social.reactions` y `social.posts` (solo columnas que cambian el recuento:
  `deleted_at`, `moderation_state`, `shared_post_id`) recalculan el post afectado. Recalcular (no ±1) hace que el
  valor no derive nunca; vale para todos los caminos de escritura: publicar, borrar, moderar, borrar cuenta.
- El feed lee las columnas. Escribir cuesta una consulta indexada por post afectado; leer, nada extra. NO AI REQUIRED.

## Consecuencias
- Las reacciones de quien mira (`my_reactions`) siguen leyéndose por post (depende de la persona). Los recuentos de
  perfil y etiqueta son de una sola fila por pantalla y quedan como están.
