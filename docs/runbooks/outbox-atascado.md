# Eventos de dominio atascados

Síntoma: los reportes entran pero la verificación, las alertas o el feed no se actualizan. Si un evento interno lleva
más de 5 min sin procesarse, administración y operación reciben el push "Eventos internos pendientes" (ADR 0130).

```sql
-- Pendientes por carril y el más antiguo
SELECT lane, count(*), min(occurred_at) FROM platform.outbox WHERE processed_at IS NULL GROUP BY lane;
-- Los que fallan y por qué (se reintentan con espera exponencial, máx. 1 h)
SELECT id, type, attempts, left(last_error, 200) AS error, available_at
  FROM platform.outbox WHERE processed_at IS NULL AND attempts > 0 ORDER BY attempts DESC LIMIT 20;
```

1. Si no hay worker corriendo, arrancarlo (`pnpm --filter @dizaster/core worker`).
2. Si un tipo falla siempre, el error dice qué consumidor: cada consumidor es idempotente
   (`platform.outbox_consumption`), así que arreglar y desplegar basta; los reintentos lo completan solos.
3. No borrar filas del outbox ni marcarlas procesadas a mano: se perdería el efecto (una alerta, una verificación).
