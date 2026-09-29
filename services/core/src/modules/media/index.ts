import { V1_MEDIA_KINDS, type MediaDelivery, type MediaKind } from "@dizaster/contracts";
import type { Queryable } from "../../platform/db.js";
import { DomainError } from "../../platform/errors.js";

/**
 * Media Engine (fundación). La subida directa a object storage, el procesamiento y la entrega por CDN
 * llegan en la etapa "Reporte y Evento". El modelo ya contempla LIVE_STREAM / WEBRTC / LL_HLS para que
 * el directo futuro no obligue a reconstruir Event, Geo ni Media.
 */
export interface StorageProvider {
  readonly id: string;
  presignUpload(key: string, mime: string, maxBytes: number, ttlSeconds: number): Promise<{ url: string; headers: Record<string, string> }>;
  publicUrl(key: string): string;
}

/** Punto de extensión para directo: un proveedor de streaming (SFU propio o gestionado). Sin implementación en V1. */
export interface LiveStreamProvider {
  readonly id: string;
  readonly delivery: Extract<MediaDelivery, "WEBRTC" | "LL_HLS" | "HLS">;
  startIngest(mediaId: string): Promise<{ ingestUrl: string; playbackUrl: string }>;
  stop(mediaId: string): Promise<void>;
}

export class MediaService {
  /** Un reporte solo puede adjuntar media propia, de un tipo soportado en V1 y ya subida. */
  async assertAttachable(q: Queryable, ownerProfileId: string, mediaIds: string[]): Promise<void> {
    if (mediaIds.length === 0) return;
    const { rows } = await q.query<{ id: string; kind: MediaKind; state: string }>(
      `SELECT id, kind, state FROM media.media WHERE id = ANY($1) AND owner_profile_id = $2`,
      [mediaIds, ownerProfileId],
    );
    if (rows.length !== new Set(mediaIds).size) throw new DomainError("MEDIA_NOT_FOUND", "Media inexistente o ajena");
    for (const r of rows) {
      if (!V1_MEDIA_KINDS.includes(r.kind)) throw new DomainError("MEDIA_KIND_UNSUPPORTED", `Tipo de media no soportado en V1: ${r.kind}`);
      if (!["UPLOADED", "PROCESSING", "READY"].includes(r.state)) throw new DomainError("MEDIA_NOT_READY", "La media aún no se ha subido");
    }
  }
}
