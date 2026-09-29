# ADR 0136 — Edición de posts

Estado: aceptada (2026-09-29, decisión del propietario: opción A)

## Contexto
§7.1 define el ciclo del POST "publicado / editado / eliminado"; solo existía borrar. El propietario eligió: editar
hasta 24 h, los posts de un reporte no se editan, el historial lo ve solo moderación.

## Decisión
- `PATCH /v1/posts/:id` con `{ text }`: solo quien lo escribió (o quien administra el negocio autor), solo posts
  STANDARD y SHARE, dentro de `POST_EDIT_WINDOW_HOURS = 24`, y no si moderación lo ocultó o retiró. Un REPORT no se
  edita (su texto es evidencia y alimenta deduplicación); un OFFICIAL_UPDATE tampoco (voz de una institución).
  Cuentas suspendidas no editan; se exige la edad declarada, como al publicar.
- Solo cambia el texto: fotos, evento y autoría quedan igual. Se rehace lo que depende del texto: idioma, huella de
  texto duplicado, etiquetas, menciones (las quitadas se borran; solo las nuevas avisan, con el mismo anti-spam del
  ADR 0063) y la revisión de datos personales (ADR 0088).
- Historial en `social.post_edits` (migración 0060): el texto anterior de cada edición. Solo aparece en el detalle del
  caso de moderación (`CaseDetail.edits`); el público solo ve "editado" (`FeedPost.editedAt`).
- `FeedPost.editableUntil` solo para quien lo escribió; la app ofrece "Editar" en el menú del post mientras no venza.
- NO AI REQUIRED; costo cero.
