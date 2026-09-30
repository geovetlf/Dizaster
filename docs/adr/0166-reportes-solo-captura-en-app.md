# ADR 0166 — Reportes solo con media capturada en la app (D-10)

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

El Blueprint aprobó D-10 (C-14): en V1, los reportes solo llevan fotos o videos capturados en la app; los posts
admiten galería. El código seguía aceptando media de galería en reportes (solo perdía la bonificación de presencia
de ADR 0073).

## Decisión

- `MediaService.assertAttachable(..., { requireInAppCapture: true })` en el envío de reportes: media con
  `captured_in_app = false` → `400 MEDIA_NOT_CAPTURED_IN_APP`. Posts, comentarios y avatares no cambian.
- App: en el reporte, `MediaAttachments cameraOnly` quita "Desde la galería" y explica que para compartir de la
  galería se publica un post. El mensaje de error del servidor está traducido.
- Un reporte guardado offline con media de galería de una versión anterior queda "Sin enviar todavía" con el motivo
  (ADR 0158): la persona puede descartarlo o quitar la media; no se pierde en silencio.
- `captured_in_app` lo declara la app; firmarlo depende de App Attest / Play Integrity (BLOQUEADO por credenciales).
