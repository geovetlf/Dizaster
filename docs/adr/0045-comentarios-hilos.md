# ADR 0045 — Comentarios: respuestas, borrado propio y reacciones

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint RF-02, §7.3 (Comment `parent_comment_id`, Reaction sobre COMMENT)

## Decisión
- **Un solo nivel de respuestas.** `POST /v1/posts/:id/comments` acepta `parentId`; responder a una respuesta cuelga
  del mismo comentario raíz. Hilos profundos son difíciles de leer en un teléfono y de moderar.
- `DELETE /v1/comments/:id`: solo quien lo escribió (a los demás, 404 como si no existiera). Borrado lógico; sus
  respuestas siguen visibles y la app las muestra como raíz. Idempotente.
- Reacciones en comentarios: `LIKE`, `SUPPORT`, `USEFUL` (sin "yo también lo vi", que solo tiene sentido sobre el
  evento). La app muestra el corazón; la API admite los tres tipos.
- `CommentView` añade `parentId`, `mine`, `reactions` y `myReactions`.
- Las reacciones en comentarios entran en el export, se borran con la cuenta y nunca cuentan como evidencia.
