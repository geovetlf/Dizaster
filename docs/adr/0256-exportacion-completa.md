# ADR 0256 — Exportación de datos completa

Fecha: 2026-09-30 · Estado: aceptada · NO AI REQUIRED

## Contexto
La exportación (ADR 0038, §13.2) omitía datos personales que el sistema sí guarda: la confirmación de edad
(`age_confirmed_min`, `age_confirmed_at`), si hay MFA activo, la foto de perfil y el control de menciones, el idioma,
la hora de edición, el retraso de publicación y el post compartido de cada publicación, y las respuestas a
"¿Es el mismo evento?" (ADR 0156).

## Decisión
- `identity.account` incluye la confirmación de edad y `mfa_enabled` (nunca el secreto ni los códigos).
- `social.profile` incluye `avatar_url` y `mentions_from`; `social.posts` incluye `lang`, `shared_post_id`, `edited_at` y `visible_after`.
- `EventService.exportData` devuelve `sameEventAnswers` (reporte, respuesta y fecha), en la sección `reports`. Los
  candidatos y la puntuación de deduplicación no salen: son del sistema, como el desglose de puntaje de ADR 0038.

## Consecuencias
- Pruebas en `test/data-export.test.ts` y `test/same-event-question.test.ts`.
