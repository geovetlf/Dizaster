# ADR 0253 — Enlaces compartidos de posts también en iOS

Fecha: 2026-09-30 · Estado: aceptada · NO AI REQUIRED

## Contexto
ADR 0083 comparte posts como `https://<dominio>/p/<id>`. Android ya declaraba `/p/` en sus App Links, pero
`apple-app-site-association` solo listaba `/e/*`: en iOS el enlace de un post abría el navegador y no la app.

## Decisión
- `apple-app-site-association` incluye `/p/*` junto a `/e/*`.
- `apps/mobile/test/link-parity.test.ts` compara las rutas de Android (`app.config.ts`) con las de iOS para que no vuelvan a divergir.

## Consecuencias
- El Team ID y el dominio siguen pendientes (D-21, README de `infra/link-domain`).
