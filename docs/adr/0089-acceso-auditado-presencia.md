# ADR 0089 — Acceso auditado a la evidencia de presencia

- Estado: aceptada (2026-09-29)
- Blueprint: §7.3, §13.1 ("datos restringidos solo accesibles a roles con motivo registrado en auditoría"), ADR 0048
- IA: **NO AI REQUIRED**. Costo: 0.

## Contexto

La evidencia de presencia (ubicación precisa cifrada del teléfono, integridad, desglose del puntaje) solo la veía
el motor. Moderación necesita revisarla ante sospecha de ubicación falsa, pero cada acceso debe quedar registrado.

## Decisión

- `POST /v1/moderation/posts/:id/presence { reason, caseId? }`. Es un POST porque cada consulta es un acto
  auditado. Condiciones:
  - rol de moderación o administración;
  - motivo de 10 a 500 caracteres;
  - como mucho 30 consultas por persona y hora (con bloqueo para que no se salte en paralelo);
  - `no-store`.
- La respuesta trae banda y puntaje, distancia del fix al pin, integridad, ubicación simulada, razones, desglose
  y la **ubicación precisa descifrada solo si aún no se generalizó**.
- `report.presence_access_log` guarda quién, cuándo, qué reporte, motivo, caso y si se mostró la ubicación
  precisa. Un disparador impide editar o borrar filas. Administración lo consulta en `GET /v1/admin/presence-access`.
- Transparencia: la exportación de datos de la persona incluye cuándo se consultó la presencia de sus reportes,
  sin decir quién.
- App: en un caso sobre un post, "Ver presencia (queda registrado)" usa el mismo motivo escrito para las acciones.

## Consecuencias

- Pruebas: `services/core/test/presence-access.test.ts`, `apps/mobile/test/moderation-logic.test.ts`.
