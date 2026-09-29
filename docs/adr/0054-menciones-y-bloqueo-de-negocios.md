# ADR 0054 — Mencionar y bloquear negocios

- Estado: Aceptado · Fecha: 2026-09-29 · Completa ADR 0028 (perfiles de negocio)

## Decisión
- Los handles ya son únicos entre personas y negocios, así que `@x` y `/v1/blocks/x` siguen siendo inequívocos:
  no hace falta sintaxis ni rutas nuevas.
- Menciones: `social.post_business_mentions`. Solo negocios existentes y visibles. `FeedPost.mentions` incluye personas
  y negocios; `FeedPost.businessMentions` dice cuáles son negocios para que la app enlace a `/b/<handle>`.
- Bloqueo: `social.business_blocks`. `PUT|DELETE /v1/blocks/:handle` resuelve persona o negocio. Bloquear un negocio
  oculta sus posts en el feed de quien bloquea y deja de seguirlo; quien lo administra no se entera. No se bloquea un
  negocio propio. `BusinessView.blockedByMe`; `/v1/me/blocks` y la exportación de datos incluyen ambos tipos.
- Borrar un negocio, un post o la cuenta limpia estas filas.

## Fuera de alcance
- Un negocio no bloquea personas: el bloqueo es una protección personal, y el negocio lo administra una persona que
  ya puede bloquear con su propia cuenta.
- Avisos push por mención (ni de personas ni de negocios) siguen fuera de V1.
