# ADR 0181 — Pruebas de captura del medio en la evidencia de presencia

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

§7 (ReportPresenceEvidence `media_capture_proofs`; Media `capture_geo` privado). La presencia ya sumaba un bono por
media de cámara (ADR 0073) pero solo guardaba un número: moderación no podía ver qué medio fue ni cuánto antes del
reporte se tomó.

## Decisión

- Migración 0087: `report.presence_evidence.media_capture_proofs` (jsonb). Por cada medio capturado en la app:
  id, tipo, hora de captura, hora en que el servidor vio la subida y segundos antes del reporte.
- Vive junto a la presencia: misma privacidad (solo moderación con motivo, ADR 0089) y misma retención.
- La revisión de presencia de moderación (`PresenceReview.mediaCaptureProofs`) y la app de moderación lo muestran.
- **No** se recoge la ubicación de cada captura (`capture_geo`): el reporte ya lleva la ubicación del teléfono y
  una segunda ubicación precisa por medio sería más dato personal sin mejorar la regla (minimización, §13.2).
  `media.capture_h3_r9` sigue vacía.

## Consecuencias

- La puntuación de presencia no cambia (`presence-3`): esto es registro para revisar, no una regla nueva.
