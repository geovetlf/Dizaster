# ADR 0168 — Acceso auditado de moderación al original de una foto o video

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: una lectura del almacenamiento por acceso

## Contexto

ADR 0042 guarda el original sin difuminar "para moderación y disputas" (durante `MEDIA_ORIGINAL_RETENTION_DAYS`),
pero no había forma de verlo: ante una denuncia de montaje o de difuminado abusivo, moderación solo veía la versión
pública. §13.1 exige que todo acceso a datos privados tenga motivo y quede auditado.

## Decisión

- `POST /v1/moderation/media/:id/original {reason, caseId?}` (permiso `content.moderate`, MFA de personal): máximo 30
  por persona y hora; registra quién, qué, por qué y el caso en `media.original_access_log` (migración 0077, solo
  inserción) y devuelve una ruta con un token aleatorio que vale 60 s (en la base solo su hash).
- `GET /v1/moderation/media-originals/:token`: sin sesión (el token es la credencial, así la app lo carga en un
  `<Image>`), `no-store`. El archivo se sirve SIN metadatos (nunca el GPS del teléfono) pero sin el difuminado.
- Original ya borrado por retención: `410 ORIGINAL_GONE`.
- `GET /v1/admin/media-original-access`: el registro, para administración; en la app aparece junto al registro de
  consultas de presencia. En el caso de moderación, cada foto o video tiene "Ver original (con motivo)".
