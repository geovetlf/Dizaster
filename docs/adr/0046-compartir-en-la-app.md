# ADR 0046 — Compartir dentro de la app

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint RF-02, §7.3 (Share: "compartir interno es un Post `kind = SHARE`")

## Decisión
- `POST /v1/posts/:id/share` crea un post `SHARE` con comentario opcional que apunta al original
  (`social.posts.shared_post_id`, con una restricción que lo exige solo en SHARE). Compartir algo compartido comparte el
  original: nunca hay cadenas.
- El SHARE no hereda media, evento ni ubicación: no toca pines, verificación ni el feed del evento. Sí hereda la
  categoría para los filtros del feed. Puede ser seudónimo o de un negocio, como cualquier post.
- Cuenta en el cupo de publicaciones por hora de la persona.
- El feed incrusta el original leído con las mismas reglas (moderación, bloqueos). Si se borró o se ocultó, el
  SHARE muestra "ya no está disponible" (`share.post = null`), sin dar detalles. `shareCount` cuenta los SHARE visibles.
- App: el botón de compartir ofrece "Compartir en Dizaster" (compositor con comentario opcional) o fuera de la app
  (hoja del sistema con el enlace, como antes).
- No se registran los compartidos externos: no aportan a nada de V1 y serían datos de comportamiento sin uso.
