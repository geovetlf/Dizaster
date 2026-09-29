import type { SubmitReportRequest, SubmitReportResponse } from "@dizaster/contracts";

/**
 * Cola offline de reportes. En un desastre la red cae justo cuando la gente quiere reportar:
 * el reporte se guarda con su id (UUIDv7) y se reenvía al volver la conexión. El servidor es idempotente
 * por clientReportId, así que reintentar nunca duplica.
 */
export interface QueuedReport {
  clientReportId: string;
  body: SubmitReportRequest;
  attempts: number;
  lastError: string | null;
  createdAt: string;
}

export interface QueueStorage {
  put(item: QueuedReport): Promise<void>;
  all(): Promise<QueuedReport[]>;
  remove(clientReportId: string): Promise<void>;
}

export type Sender = (body: SubmitReportRequest) => Promise<{ ok: true; response: SubmitReportResponse } | { ok: false; retryable: boolean; error: string }>;

export class ReportQueue {
  constructor(
    private readonly storage: QueueStorage,
    private readonly maxAttempts = 20,
  ) {}

  async enqueue(body: SubmitReportRequest, now = new Date()): Promise<void> {
    await this.storage.put({ clientReportId: body.clientReportId, body, attempts: 0, lastError: null, createdAt: now.toISOString() });
  }

  async pending(): Promise<QueuedReport[]> {
    return (await this.storage.all()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /** Envía en orden de captura. Los errores definitivos (4xx) salen de la cola; los de red se reintentan. */
  async flush(send: Sender): Promise<{ sent: SubmitReportResponse[]; failed: number; dropped: number }> {
    const sent: SubmitReportResponse[] = [];
    let failed = 0;
    let dropped = 0;
    for (const item of await this.pending()) {
      const res = await send(item.body);
      if (res.ok) {
        sent.push(res.response);
        await this.storage.remove(item.clientReportId);
      } else if (!res.retryable || item.attempts + 1 >= this.maxAttempts) {
        dropped++;
        await this.storage.remove(item.clientReportId);
      } else {
        failed++;
        await this.storage.put({ ...item, attempts: item.attempts + 1, lastError: res.error });
      }
    }
    return { sent, failed, dropped };
  }
}

export class MemoryQueueStorage implements QueueStorage {
  private readonly items = new Map<string, QueuedReport>();
  async put(item: QueuedReport) { this.items.set(item.clientReportId, item); }
  async all() { return [...this.items.values()]; }
  async remove(id: string) { this.items.delete(id); }
}
