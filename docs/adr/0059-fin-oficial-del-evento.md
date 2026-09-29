# ADR 0059 — Fin oficial de un evento (cancelación y expiración de la fuente)

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint §5.7, §10.1

## Decisión
- Los adaptadores pueden declarar `withdrawals()`: ids externos que la fuente retiró. CAP lo implementa con `Cancel`
  (por la referencia al mensaje original). El planificador marca `withdrawn_at`. Una cancelación no es un desmentido
  (no genera NOT_OCCURRING).
- `NormalizedItem.endsAt` guarda hasta cuándo vale la alerta (CAP `expires`) en `ends_at`.
- Cada hora el worker pide a ingestion los ítems terminados en los últimos 7 días y el módulo event pasa a RESOLVED
  los eventos cuya evidencia activa es SOLO de esos ítems. Timeline: `STATUS_CHANGED` con causa `SOURCE_WITHDRAWN` o
  `SOURCE_EXPIRED`. Si hay un reporte ciudadano o una fuente vigente, no se toca: sigue el ciclo por inactividad.
- AI_REQUIRED = NO · EXTERNAL_API_REQUIRED = NO (usa las fuentes ya registradas) · COST = ZERO.
