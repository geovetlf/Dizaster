import type { DomainEvent, DomainEventMap, DomainEventType, OutboxLane } from "@dizaster/contracts";
import type { Db, Queryable } from "./db.js";
import { withTransaction } from "./db.js";
import { newId } from "./ids.js";

/**
 * Transactional outbox: el evento de dominio se guarda en la MISMA transacción que el cambio de datos.
 * El bus real queda detrás de esta interfaz; cambiarlo (NATS, Kafka, SQS...) no toca los módulos.
 */
export async function publish<T extends DomainEventType>(
  tx: Queryable,
  type: T,
  payload: DomainEventMap[T],
  opts: { lane?: OutboxLane; correlationId?: string | null } = {},
): Promise<string> {
  const id = newId();
  await tx.query(
    `INSERT INTO platform.outbox (id, type, payload, lane, correlation_id) VALUES ($1, $2, $3, $4, $5)`,
    [id, type, JSON.stringify(payload), opts.lane ?? "normal", opts.correlationId ?? null],
  );
  return id;
}

export type Handler<T extends DomainEventType = DomainEventType> = (event: DomainEvent<T>, tx: Queryable) => Promise<void>;

interface Registration {
  consumer: string;
  type: DomainEventType;
  handler: Handler;
}

/** Orden de prioridad: una cola de lote nunca retrasa a la urgente. */
const LANE_ORDER: OutboxLane[] = ["urgent", "interactive", "normal", "batch"];

export class OutboxDispatcher {
  private readonly registrations: Registration[] = [];

  constructor(private readonly db: Db) {}

  on<T extends DomainEventType>(type: T, consumer: string, handler: Handler<T>): void {
    this.registrations.push({ consumer, type, handler: handler as Handler });
  }

  /** Procesa hasta `max` eventos pendientes. Devuelve cuántos procesó. */
  async runOnce(max = 100, lanes: OutboxLane[] = LANE_ORDER): Promise<number> {
    let processed = 0;
    while (processed < max) {
      const done = await withTransaction(this.db, async (tx) => {
        const { rows } = await tx.query<{
          id: string; type: DomainEventType; version: number; payload: unknown; lane: OutboxLane;
          correlation_id: string | null; occurred_at: Date; attempts: number;
        }>(
          `SELECT id, type, version, payload, lane, correlation_id, occurred_at, attempts
             FROM platform.outbox
            WHERE processed_at IS NULL AND available_at <= now() AND lane = ANY($1)
            ORDER BY array_position($2::text[], lane), occurred_at
            LIMIT 1
            FOR UPDATE SKIP LOCKED`,
          [lanes, LANE_ORDER],
        );
        const row = rows[0];
        if (!row) return false;
        const event = {
          id: row.id, type: row.type, version: row.version, payload: row.payload, lane: row.lane,
          correlationId: row.correlation_id, occurredAt: row.occurred_at.toISOString(),
        } as DomainEvent;
        await tx.query("SAVEPOINT handlers");
        try {
          for (const r of this.registrations.filter((x) => x.type === row.type)) {
            const claimed = await tx.query(
              `INSERT INTO platform.outbox_consumption (consumer, outbox_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
              [r.consumer, row.id],
            );
            if (claimed.rowCount === 1) await r.handler(event, tx);
          }
          await tx.query(`UPDATE platform.outbox SET processed_at = now() WHERE id = $1`, [row.id]);
        } catch (err) {
          // Reintento con espera exponencial; el error queda registrado para observabilidad.
          await tx.query("ROLLBACK TO SAVEPOINT handlers");
          await tx.query(
            `UPDATE platform.outbox SET attempts = attempts + 1, last_error = $2,
                    available_at = now() + make_interval(secs => least(3600, 2 ^ (attempts + 1)))
              WHERE id = $1`,
            [row.id, String(err instanceof Error ? err.stack ?? err.message : err).slice(0, 4000)],
          );
        }
        return true;
      });
      if (!done) break;
      processed++;
    }
    return processed;
  }

  /** Pendientes y antigüedad del más viejo (ADR 0130): si crece, el worker no da abasto o un consumidor falla. */
  async backlog(): Promise<{ pending: number; oldestPendingSeconds: number | null; failing: number }> {
    const { rows } = await this.db.query<{ pending: number; oldest: number | null; failing: number }>(
      `SELECT count(*)::int AS pending, extract(epoch FROM now() - min(occurred_at))::float8 AS oldest,
              count(*) FILTER (WHERE attempts > 0)::int AS failing
         FROM platform.outbox WHERE processed_at IS NULL`,
    );
    const r = rows[0]!;
    return { pending: r.pending, oldestPendingSeconds: r.oldest === null ? null : Math.round(r.oldest), failing: r.failing };
  }

  /**
   * Retención (§13.2, ADR 0165): borra lo ya procesado con más de `days` días. Lo pendiente nunca se toca. Los
   * consumos se borran en cascada. Por lotes, para no bloquear la tabla.
   */
  async purgeProcessed(days: number, batch = 5000): Promise<number> {
    let total = 0;
    for (;;) {
      const r = await this.db.query(
        `DELETE FROM platform.outbox WHERE id IN (
           SELECT id FROM platform.outbox WHERE processed_at IS NOT NULL AND processed_at < now() - make_interval(days => $1) LIMIT $2)`,
        [days, batch],
      );
      total += r.rowCount ?? 0;
      if ((r.rowCount ?? 0) < batch) return total;
    }
  }

  /** Procesa hasta vaciar la cola (tests y arranque). */
  async drain(): Promise<number> {
    let total = 0;
    for (;;) {
      const n = await this.runOnce(500);
      total += n;
      if (n === 0) return total;
    }
  }
}
