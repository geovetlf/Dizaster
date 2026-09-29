# ADR 0126 — Reglas de exclusión de publicidad (sin anuncios en V1)

Estado: aceptada (2026-09-29)

## Contexto
D-14 decidió **no** tener publicidad en V1, pero dejar "diseño y reglas de exclusión listos" (§5.16, C-09): nunca en
alertas, emergencia, reportes ni eventos de severidad alta; nunca segmentación por ubicación precisa; anuncios
claramente marcados. Las reglas solo estaban en el Blueprint.

## Decisión
- `packages/contracts/src/advertising.ts`, lógica pura compartida por servidor y app:
  - `ADS_ENABLED_V1 = false`: cualquier ubicación se rechaza con `ADS_DISABLED_V1` mientras no cambie D-14.
  - `adPlacementDenials(ctx)` devuelve todos los motivos: superficie prohibida (alerta, emergencia, reportar,
    publicar, moderación, ajustes), evento de severidad > 3, evento sensible, evento en curso bajo el anuncio en el
    mapa, segmentación más fina que región y anuncio sin marca "Patrocinado".
- Ningún módulo muestra anuncios. Una implementación futura (espacios, promoción de negocios) debe consultar esta
  función en el servidor y en la app; relajar una regla es cambiar este archivo con un ADR.
- NO AI REQUIRED; costo 0. No se integra ninguna red publicitaria ni SDK.
