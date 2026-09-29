import type { SubmitReportRequest, SubmitReportResponse } from "@dizaster/contracts";
import type { LocalMedia } from "../media/local-media";

/**
 * Cola offline de reportes. En un desastre la red cae justo cuando la gente quiere reportar:
 * el reporte se guarda con su id (UUIDv7) y se reenvía al volver la conexión. El servidor es idempotente
 * por clientReportId, así que reintentar nunca duplica.
 */
/** Media local del reporte. `mediaId` se guarda en cuanto se sube, para no repetir la subida al reintentar. */
export interface QueuedMedia extends LocalMedia {
  mediaId?: string;
  /** Subida descartada por error definitivo: el reporte sale igual, sin este archivo. */
  failed?: string;
}

export interface QueuedReport {
  clientReportId: string;
  body: SubmitReportRequest;
  media?: QueuedMedia[];
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
export type MediaUploader = (m: LocalMedia) => Promise<{ ok: true; mediaId: string } | { ok: false; retryable: boolean; error: string }>;

export interface FlushResult {
  sent: SubmitReportResponse[];
  failed: number;
  dropped: number;
  /** Respuesta de cada reporte enviado, por su clientReportId. */
  byClientId: Record<string, SubmitReportResponse>;
}

export class ReportQueue {
  constructor(
    private readonly storage: QueueStorage,
    private readonly maxAttempts = 20,
  ) {}

  async enqueue(body: SubmitReportRequest, now = new Date(), media: LocalMedia[] = []): Promise<void> {
    await this.storage.put({ clientReportId: body.clientReportId, body, media, attempts: 0, lastError: null, createdAt: now.toISOString() });
  }

  async pending(): Promise<QueuedReport[]> {
    return (await this.storage.all()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /**
   * Envía en orden de captura. Primero sube la media pendiente del reporte y después el reporte con sus ids.
   * Los errores definitivos (4xx) salen de la cola; los de red se reintentan. Una foto que falla de forma
   * definitiva no bloquea el reporte: en un desastre importa más que el aviso llegue.
   */
  async flush(
    send: Sender,
    upload?: MediaUploader,
    onDone?: (item: QueuedReport) => void,
  ): Promise<FlushResult> {
    const sent: SubmitReportResponse[] = [];
    const byClientId: Record<string, SubmitReportResponse> = {};
    let failed = 0;
    let dropped = 0;
    for (const queued of await this.pending()) {
      let item = queued;
      const media = item.media ?? [];
      if (media.some((m) => !m.mediaId && !m.failed)) {
        if (!upload) { failed++; continue; }
        const uploaded = await this.uploadPending(item, media, upload);
        if (!uploaded.ok) {
          failed++;
          await this.storage.put({ ...uploaded.item, attempts: item.attempts + 1, lastError: uploaded.error });
          continue;
        }
        item = uploaded.item;
      }
      const mediaIds = media.length ? (item.media ?? []).flatMap((m) => (m.mediaId ? [m.mediaId] : [])) : item.body.mediaIds;
      const res = await send({ ...item.body, mediaIds });
      if (res.ok) {
        sent.push(res.response);
        byClientId[item.clientReportId] = res.response;
        await this.storage.remove(item.clientReportId);
        onDone?.(item);
      } else if (!res.retryable || item.attempts + 1 >= this.maxAttempts) {
        dropped++;
        await this.storage.remove(item.clientReportId);
        onDone?.(item);
      } else {
        failed++;
        await this.storage.put({ ...item, attempts: item.attempts + 1, lastError: res.error });
      }
    }
    return { sent, failed, dropped, byClientId };
  }

  private async uploadPending(
    item: QueuedReport, media: QueuedMedia[], upload: MediaUploader,
  ): Promise<{ ok: true; item: QueuedReport } | { ok: false; item: QueuedReport; error: string }> {
    const next = [...media];
    for (let i = 0; i < next.length; i++) {
      const m = next[i]!;
      if (m.mediaId || m.failed) continue;
      const r = await upload(m);
      if (r.ok) next[i] = { ...m, mediaId: r.mediaId };
      else if (!r.retryable) next[i] = { ...m, failed: r.error };
      else return { ok: false, item: { ...item, media: next }, error: r.error };
      // Progreso persistido: si la app se cierra, no se vuelve a subir lo ya subido.
      await this.storage.put({ ...item, media: next });
    }
    return { ok: true, item: { ...item, media: next } };
  }
}

export class MemoryQueueStorage implements QueueStorage {
  private readonly items = new Map<string, QueuedReport>();
  async put(item: QueuedReport) { this.items.set(item.clientReportId, item); }
  async all() { return [...this.items.values()]; }
  async remove(id: string) { this.items.delete(id); }
}
