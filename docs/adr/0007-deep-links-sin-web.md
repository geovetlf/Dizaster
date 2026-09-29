# ADR 0007 — Enlaces sin versión web

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint §C-11

## Decisión
- Esquema propio `dizaster://event/<id>` desde ya (Expo Router: `src/app/event/[id].tsx`).
- Universal Links / App Links con `https://<dominio>/e/<id>` se activan con `DIZASTER_LINK_DOMAIN` al compilar; el dominio solo sirve los dos archivos `.well-known` de `infra/link-domain/` (sin HTML).
- La vista previa para quien no tiene la app no se construye; solo se añadiría si resulta estrictamente necesaria.
