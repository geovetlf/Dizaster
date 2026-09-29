# ADR 0119 — Foto de perfil y logo de negocio

Estado: aceptada (2026-09-29)

## Contexto
§7.3 y RF-02 piden perfil con foto; los negocios necesitan logo. La app solo mostraba iniciales.

## Decisión
- Migración 0051: `social.profiles.avatar_media_id/avatar_url` y `social.business_profiles.logo_media_id/logo_url`.
  Se guarda la URL de la miniatura pública (≤ 400 px, re-codificada y sin EXIF por el Media Engine) para no consultar
  media en cada lectura del feed.
- `PUT /v1/me/avatar` y `PUT /v1/businesses/:handle/logo` con `{ mediaId | null }`. Solo media propia, IMAGE, ya
  procesada (si no: 409 `MEDIA_NOT_READY`) y que no esté en un post; a la inversa, una foto de perfil no se adjunta a
  un post (409 `MEDIA_IN_USE`): cada una tiene su ciclo de vida y borrar un post no se lleva la foto. La foto
  sustituida o quitada se purga si nada más la usa. El logo solo lo cambia quien administra el negocio.
- La URL sale en `ProfileView.avatarUrl`, `BusinessView.logoUrl`, el autor de posts y comentarios y la búsqueda de
  perfiles. Un post seudónimo nunca la lleva (el autor sigue siendo solo la etiqueta).
- Moderación: acción `REMOVE_AVATAR` en casos de PROFILE y BUSINESS; quita la imagen, purga su media, cierra el caso
  y queda en el registro inmutable. No toca la cuenta ni sus posts.
- Borrar la cuenta (y sus negocios) o un negocio vacía la foto/logo; la media de la cuenta ya se purga entera.
- App: componente `Avatar` (foto o iniciales; círculo para personas, cuadrado para negocios) en tarjetas, perfil,
  negocio, búsqueda y comentarios; `AvatarPicker` en editar perfil y editar negocio: galería → re-codificación en el
  dispositivo → subida → espera a la versión saneada (`waitForProcessed`, 20 × 1 s) → se fija al momento.
  NO AI REQUIRED; coste: una miniatura por persona en el almacenamiento ya existente.

## Consecuencias
- Si cambia la base pública del almacenamiento, las URLs guardadas deben reescribirse con un script (igual que
  cualquier URL pública ya compartida).
- La foto de un negocio borrado queda en la biblioteca de su dueño hasta que la reutilice o borre la cuenta.
