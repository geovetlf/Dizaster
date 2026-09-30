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
3. Tras 15 intentos (unas 5 h) el evento pasa a **cuarentena** (ADR 0206): deja de reintentarse y de contar como
   atasco, y llega el push "Eventos internos en cuarentena". Después de desplegar el arreglo:
   ```sh
   pnpm --filter @dizaster/core outbox dead            # qué hay en cuarentena y por qué
   pnpm --filter @dizaster/core outbox replay          # devolver todo a la cola (o: replay <id> <id>)
   ```
4. No borrar filas del outbox ni marcarlas procesadas a mano: se perdería el efecto (una alerta, una verificación).
