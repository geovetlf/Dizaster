# ADR 0114 — Cabeceras de seguridad HTTP en la API

Estado: aceptada (2026-09-29)

## Decisión
Un hook `onRequest` en `http/app.ts` añade `SECURITY_HEADERS` a toda respuesta (también errores y 404):
HSTS (1 año, subdominios), `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
`Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `Cross-Origin-Resource-Policy: same-site` y
`Permissions-Policy` sin geolocalización, cámara ni micrófono. La API solo sirve JSON y teselas: nada que ejecutar
ni incrustar. Sin dependencias nuevas (§13.1). NO AI REQUIRED.

## Consecuencias
- Si algún día la API sirve HTML (página técnica de enlaces), esa ruta necesitará su propia CSP.
