# ADR 0165 — Retención de datos operativos

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: reduce almacenamiento

## Contexto

§13.2 (minimización) y §12 (costo): varias tablas operativas crecían sin límite. La última ubicación aproximada de
"cerca de mí" solo se usaba 72 h pero no se borraba nunca; el outbox guardaba cada evento de dominio procesado; el
historial de avisos solo se borraba al eliminar la cuenta.

## Decisión

Tarea diaria del worker (rol `maintenance`):

- `alert.last_locations`: se borra lo visto hace más de 72 h (misma ventana con la que ya se consultaba).
- `alert.notifications`: se borra lo creado hace más de `NOTIFICATION_RETENTION_DAYS` (90 por defecto, mínimo 7),
  salvo lo que aún está PENDING de entregarse. Las filas de `alert.alerts` se conservan: su `dedup_key` impide
  repetir un aviso sobre un evento que dura meses, y no contienen datos personales.
- `platform.outbox`: se borra lo procesado hace más de `OUTBOX_RETENTION_DAYS` (14 por defecto), por lotes de 5000;
  sus consumos se van en cascada. Lo pendiente nunca se toca.

## Consecuencias

- "Quien ya recibió avisos de este evento" (ADR 0157 y anteriores) mira el historial vigente: en un evento de más de
  90 días, quien fue avisado al principio y no lo sigue deja de recibir actualizaciones. Quien lo sigue, no.
