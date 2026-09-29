# ADR 0073 — Bonificación de presencia por foto/video capturado en la app

- Estado: aceptada (2026-09-29)
- Blueprint: §8.2 (término `w5 * f_media_in_app`)
- IA: **NO AI REQUIRED**. Costo adicional: 0 (una consulta a `media.media` al recibir el reporte).

## Contexto

La fórmula de presencia del Blueprint incluye una bonificación por media capturada con la cámara de la app cerca
del momento del reporte. `presence-1` no la aplicaba.

## Decisión

- Nueva versión de reglas `presence-2` en `@dizaster/geo-kit`: los cuatro pesos de `presence-1` (que suman 1) más
  `mediaInApp = 0.1`. `presence-1` sigue exportada para auditar reportes guardados con ella.
- Prueba de media: foto o video adjunto al reporte, del mismo perfil, marcado `captured_in_app` y con hora de captura.
  El servidor aporta la hora en que vio la subida (`media.created_at`).
- Factor: 1 si la captura está a ≤ 5 min de la hora del reporte, decae hasta 0 a los 30 min. Se toma la mejor prueba.
- Una prueba no cuenta si el servidor vio la subida más de 5 min antes de la supuesta captura (fecha retocada) o,
  en un envío en línea, si la captura está a más de 30 min de la hora del servidor.
- La bonificación nunca rompe los topes: fuera del radio sigue sin llegar a MEDIUM y sin atestación genuina sigue
  sin llegar a HIGH. El desglose guardado incluye `mediaInApp`.

## Consecuencias

- Una persona con GPS mediocre (edificios, interior) que adjunta una foto del momento puede pasar de MEDIUM a HIGH.
- `captured_in_app` lo declara la app y todavía no va firmado (App Attest / Play Integrity están bloqueados por
  credenciales del dueño); por eso la bonificación es pequeña. Cuando exista la firma, se calibrará en `presence-3`.
- Pruebas: `packages/geo-kit/test/geo-kit.test.ts` (bonificación, fotos viejas o incoherentes, topes, presence-1) y
  `services/core/test/media.test.ts` (desglose guardado con cámara y con galería).
