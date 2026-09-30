# ADR 0232 — Registros de estado, gravedad, división y fuentes: solo inserción

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

§13.1 pide auditoría inmutable. ADR 0048 protegió las transiciones de verificación, las acciones de moderación y
otros registros, pero `event.status_log`, `event.severity_log`, `event.split_log` e `ingestion.source_status_log`
podían editarse o borrarse desde la base.

## Decisión

- Migración 0097: disparador `platform.audit_append_only()` antes de UPDATE o DELETE en las cuatro tablas. Ningún
  código las modificaba, así que no cambia ningún comportamiento.

## Consecuencias

- Todos los registros de auditoría del sistema son de solo inserción. Prueba en `append-only-logs.test.ts`.
