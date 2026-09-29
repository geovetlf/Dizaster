# ADR 0130 — Alertas operativas por SLO incumplido y cola atascada

Estado: aceptada (2026-09-29)

## Contexto
§5.22 pide "alertas operativas" sobre los SLO (API p95 < 300 ms, alerta oficial URGENT entregada < 2 min). El
tablero de calidad (ADR 0026) ya los calculaba, pero nadie se enteraba si nadie lo abría. Solo avisaban por push
los presupuestos (ADR 0019) y las fuentes urgentes caídas (ADR 0058).

## Decisión
- `QualityService.checkOperational()`, llamado por el worker cada 5 min, juzga sobre el último día los mismos SLO
  del tablero (`api_p95`, `urgent_chain_p95`, `moderation_oldest_open`) y además la cola de eventos internos:
  `outbox_oldest_pending` ≤ 300 s (`OutboxDispatcher.backlog()`). Si pasa más, el worker está caído o un
  consumidor falla (runbook "Eventos de dominio atascados").
- Se avisa por push a administración y operación, en su idioma, solo al cambiar de estado (incumplido ↔
  recuperado). El estado vive en `quality.ops_alert_state` (migración 0057); el módulo de calidad pasa a tener ese
  único esquema propio. Sin datos no se juzga; algo que nunca se incumplió no avisa al "recuperarse".
- Los avisos no entran al historial de alertas públicas y no son críticos. Cambiar un objetivo sigue siendo una
  decisión (ADR 0026). NO AI REQUIRED; costo cero.

## Pendiente (propietario)
La vigilancia externa de que el propio worker está vivo (ADR 0058) depende del hosting: si el worker muere, este
chequeo tampoco corre.
