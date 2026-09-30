# ADR 0178 — Posts y comentarios idempotentes

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

§13.1 pide reintentos idempotentes y §7.3 ids generables en el cliente. Los reportes ya lo cumplían
(`clientReportId`), pero un post o un comentario reenviado tras un corte de red se publicaba dos veces.

## Decisión

- `clientId` opcional (UUID) en `CreatePostRequest` y `CreateCommentRequest`. Migración 0085: `client_id` en
  `social.posts` (único por autor, persona o negocio) y en `social.comments` (único por perfil).
- Post: si ya existe uno de ese autor con ese id, se devuelve el mismo resultado (post, evento, etiquetas, menciones)
  sin gastar cupo. Dos envíos simultáneos: el segundo choca con el índice único y devuelve el primero.
- Comentario: igual, dentro del mismo post; el mismo id en otro post responde 409 `CLIENT_ID_REUSED`.
- Sin `clientId` todo sigue como antes. El id de otra persona no da acceso a nada: la búsqueda es por autor.
- App: el borrador de publicación y el de comentario llevan un id que se repite en cada reintento y cambia tras
  enviarse bien.

## Consecuencias

- Si el primer envío sí se creó y la persona cambió el texto antes de reintentar, se devuelve lo ya publicado.
