# ADR 0113 — Auditoría inmutable en verificación, moderación y fusiones

Estado: aceptada (2026-09-29)

## Contexto
§4 (principio 4), §7.3 y §13.1 piden historial inmutable. Solo `report.presence_access_log` lo garantizaba en la base
(ADR 0089); `verification.transitions`, `moderation.actions` y `event.merge_log` dependían de que el código no los
tocara.

## Decisión
Migración 0048:
- `platform.audit_append_only()` + triggers `BEFORE UPDATE OR DELETE` en `verification.transitions` y
  `moderation.actions`: solo inserción. Una corrección es una fila nueva (p. ej. una acción que revierte a otra).
- `event.merge_log_guard()`: no se borra; solo se puede registrar la reversión (`reverted_at`, `reverted_by`,
  `revert_reason`) y una única vez.
- Garantía en la base, no solo en el código: vale también para scripts y accesos manuales. NO AI REQUIRED.

## Consecuencias
- Un borrado masivo de auditoría exige quitar el trigger con una migración revisada. `TRUNCATE`/`DROP` siguen siendo
  operaciones de administrador de base de datos.
