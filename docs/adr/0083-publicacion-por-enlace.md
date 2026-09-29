# ADR 0083 — Publicación por enlace y enlaces universales /e/ y /p/

- Estado: aceptada (2026-09-29)
- Blueprint: §6.3, §17 fase 3 ("compartir con deep links"), ADR 0007, ADR 0046
- IA: **NO AI REQUIRED**. Costo: 0.

## Contexto

La app comparte `https://<dominio>/e/<id>` y `/p/<id>`, pero no había pantallas para esas rutas y Android solo
declaraba `/e/`. La pantalla `post/[id]` solo cargaba comentarios: un enlace a una publicación no mostraba la
publicación. Y no existía `GET /v1/posts/:id`.

## Decisión

- `GET /v1/posts/:id` devuelve un `FeedPost` con **las mismas reglas del feed** (pública, visible, sin bloqueos del
  lector, negocio activo, media según sensibilidad). Si el feed no lo mostraría, 404. `cache-control: no-store`
  (lleva reacciones propias).
- App: `+native-intent.tsx` traduce `/e/<uuid>` → `/event/<uuid>` y `/p/<uuid>` → `/post/<uuid>`
  (`rewriteSharedLinkPath`; ids que no son UUID se dejan igual y no llegan a ninguna pantalla). La pantalla de la
  publicación muestra la tarjeta arriba y los comentarios debajo. Android declara `/e/` y `/p/`.
- Sigue sin haber web de producto: el dominio solo sirve los archivos de verificación de enlaces (D-21).

## Consecuencias

- Pruebas: `services/core/test/post-link.test.ts`, `apps/mobile/test/links.test.ts`.
