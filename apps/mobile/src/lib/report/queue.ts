import type { SubmitReportRequest, SubmitReportResponse } from "@dizaster/contracts";
import type { LocalMedia } from "../media/local-media";
import { atSendTime } from "./evidence";

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
  /** Intentos fallidos CON conexión (el servidor respondió mal). Estar sin red no cuenta (ADR 0158). */
  attempts: number;
  lastError: string | null;
  createdAt: string;
  /**
   * Detenido: error definitivo o demasiados intentos con conexión. Nunca se borra solo: queda con su media para
   * que la persona lo reintente o lo descarte.
   */
  stuck?: { reason: string; at: string };
}

export interface QueueStorage {
  put(item: QueuedReport): Promise<void>;
  all(): Promise<QueuedReport[]>;
  remove(clientReportId: string): Promise<void>;
}

/** `offline`: no hubo respuesta del servidor (sin red). Se reintenta sin gastar intentos. */
type Failure = { ok: false; retryable: boolean; error: string; offline?: boolean };
export type Sender = (body: SubmitReportRequest) => Promise<{ ok: true; response: SubmitReportResponse } | Failure>;
export type MediaUploader = (m: LocalMedia) => Promise<{ ok: true; mediaId: string } | Failure>;

export interface FlushResult {
  sent: SubmitReportResponse[];
  /** Siguen en cola y se reintentarán. */
  failed: number;
  /** Detenidos a la espera de la persona (Reintentar / Descartar). */
  stuck: number;
  /** Algún fallo fue por falta de conexión. */
  offline: boolean;
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

  /** La persona pide reintentar un reporte detenido: vuelve a la cola con los intentos a cero. */
  async retry(clientReportId: string): Promise<void> {
    const item = (await this.storage.all()).find((i) => i.clientReportId === clientReportId);
    if (!item) return;
    const { stuck: _s, ...rest } = item;
    await this.storage.put({ ...rest, attempts: 0, media: (rest.media ?? []).map(({ failed: _f, ...m }) => m) });
  }

  /** La persona descarta un reporte: sale de la cola. Devuelve el ítem para borrar sus copias locales. */
  async discard(clientReportId: string): Promise<QueuedReport | null> {
    const item = (await this.storage.all()).find((i) => i.clientReportId === clientReportId) ?? null;
    if (item) await this.storage.remove(clientReportId);
    return item;
  }

  /**
   * Envía en orden de captura. Primero sube la media pendiente del reporte y después el reporte con sus ids.
   * Sin red se reintenta siempre, sin gastar intentos. Un error definitivo (4xx) o demasiados errores con red
   * detienen el reporte, que NO se borra: queda con su media hasta que la persona lo reintente o descarte
   * (ADR 0158). Una foto que falla de forma definitiva no bloquea el reporte.
   */
  async flush(
    send: Sender,
    upload?: MediaUploader,
    onDone?: (item: QueuedReport) => void,
    now: () => Date = () => new Date(),
  ): Promise<FlushResult> {
    const sent: SubmitReportResponse[] = [];
    const byClientId: Record<string, SubmitReportResponse> = {};
    let failed = 0;
    let stuck = 0;
    let offline = false;
    const fail = async (it: QueuedReport, f: { error: string; retryable: boolean; offline?: boolean }) => {
      if (f.offline) {
        offline = true;
        failed++;
        await this.storage.put({ ...it, lastError: f.error });
      } else if (!f.retryable || it.attempts + 1 >= this.maxAttempts) {
        stuck++;
        await this.storage.put({ ...it, attempts: it.attempts + 1, lastError: f.error, stuck: { reason: f.error, at: now().toISOString() } });
      } else {
        failed++;
        await this.storage.put({ ...it, attempts: it.attempts + 1, lastError: f.error });
      }
    };
    for (const queued of await this.pending()) {
      if (queued.stuck) { stuck++; continue; }
      let item = queued;
      const media = item.media ?? [];
      if (media.some((m) => !m.mediaId && !m.failed)) {
        if (!upload) { failed++; continue; }
        const uploaded = await this.uploadPending(item, media, upload);
        if (!uploaded.ok) {
          // Una subida que falla con red se reintenta (la foto no detiene el reporte para siempre).
          await fail(uploaded.item, { error: uploaded.error, retryable: true, offline: uploaded.offline });
          continue;
        }
        item = uploaded.item;
      }
      const mediaIds = media.length ? (item.media ?? []).flatMap((m) => (m.mediaId ? [m.mediaId] : [])) : item.body.mediaIds;
      // La hora del reloj y "capturado offline" se fijan al enviar, no al capturar (§8.3).
      const res = await send(atSendTime({ ...item.body, mediaIds }, item.createdAt, now()));
      if (res.ok) {
        sent.push(res.response);
        byClientId[item.clientReportId] = res.response;
        await this.storage.remove(item.clientReportId);
        onDone?.(item);
      } else {
        await fail(item, res);
      }
    }
    return { sent, failed, stuck, offline, byClientId };
  }

  private async uploadPending(
    item: QueuedReport, media: QueuedMedia[], upload: MediaUploader,
  ): Promise<{ ok: true; item: QueuedReport } | { ok: false; item: QueuedReport; error: string; offline?: boolean }> {
    const next = [...media];
    for (let i = 0; i < next.length; i++) {
      const m = next[i]!;
      if (m.mediaId || m.failed) continue;
      const r = await upload(m);
      if (r.ok) next[i] = { ...m, mediaId: r.mediaId };
      else if (!r.retryable) next[i] = { ...m, failed: r.error };
      else return { ok: false, item: { ...item, media: next }, error: r.error, ...(r.offline ? { offline: true } : {}) };
      // Progreso persistido: si la app se cierra, no se vuelve a subir lo ya subido.
      await this.storage.put({ ...item, media: next });
    }
    return { ok: true, item: { ...item, media: next } };
  }
}

/**
 * Espera antes del siguiente reintento automático con la app abierta: 15 s, 30 s, 1 min… hasta 5 min.
 * NO AI REQUIRED.
 */
export function retryDelayMs(consecutiveFailures: number): number {
  return Math.min(5 * 60_000, 15_000 * 2 ** Math.max(0, consecutiveFailures));
}

export class MemoryQueueStorage implements QueueStorage {
  private readonly items = new Map<string, QueuedReport>();
  async put(item: QueuedReport) { this.items.set(item.clientReportId, item); }
  async all() { return [...this.items.values()]; }
  async remove(id: string) { this.items.delete(id); }
}
