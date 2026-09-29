import { createHash } from "node:crypto";
import {
  CreateUploadRequest,
  V1_MEDIA_KINDS,
  type CreateUploadResponse,
  type MediaDelivery,
  type MediaKind,
  type MediaView,
} from "@dizaster/contracts";
import type { Clock } from "../../platform/clock.js";
import { withTransaction, type Db, type Queryable } from "../../platform/db.js";
import { DomainError, notFound } from "../../platform/errors.js";
import { newId } from "../../platform/ids.js";
import { publish, type OutboxDispatcher } from "../../platform/outbox.js";
import { familyOfMime, MalformedMediaError, sanitize, sniffFamily } from "./sanitize.js";
import type { StorageProvider } from "./storage/types.js";

export type { StorageProvider } from "./storage/types.js";
export { LocalDiskStorage } from "./storage/local.js";
export { S3Storage, type S3Config } from "./storage/s3.js";

/** Punto de extensión para directo: un proveedor de streaming (SFU propio o gestionado). Sin implementación en V1. */
export interface LiveStreamProvider {
  readonly id: string;
  readonly delivery: Extract<MediaDelivery, "WEBRTC" | "LL_HLS" | "HLS">;
  startIngest(mediaId: string): Promise<{ ingestUrl: string; playbackUrl: string }>;
  stop(mediaId: string): Promise<void>;
}

export interface MediaLimits {
  uploadsPerHour: number;
  uploadUrlTtlSeconds: number;
  originalRetentionDays: number;
}

/** Variante pública saneada (sin metadatos de ubicación). La única que sale por la API. */
export const PUBLIC_VARIANT = "DISPLAY";

const EXT: Record<string, string> = { "image/jpeg": "jpg", "video/mp4": "mp4", "video/quicktime": "mov" };

interface MediaRow {
  id: string; owner_profile_id: string; kind: MediaKind; state: string; mime: string; bytes: string; sha256: string;
  storage_key_original: string | null; width: number | null; height: number | null; duration_ms: number | null;
  captured_in_app: boolean; upload_expires_at: Date | null;
}

/**
 * Media Engine V1: foto y video grabado.
 * 1. El dispositivo pide una subida (tipo, tamaño y hash declarados) y sube directo al almacenamiento.
 * 2. Al completar, el servidor comprueba que el objeto existe con el tamaño y tipo firmados.
 * 3. El worker descarga el original (privado), verifica el hash y el tipo real, retira los metadatos de
 *    ubicación y guarda la variante pública. Solo entonces la media queda READY.
 * El modelo ya contempla LIVE_STREAM / WEBRTC / LL_HLS para que el directo futuro no reconstruya nada.
 */
export class MediaService {
  constructor(
    private readonly db: Db,
    private readonly storage: StorageProvider,
    private readonly clock: Clock,
    private readonly limits: MediaLimits,
  ) {}

  registerHandlers(dispatcher: OutboxDispatcher): void {
    dispatcher.on("MediaUploaded", "media.process", async (e, tx) => {
      await this.process(tx, e.payload.mediaId);
    });
  }

  async createUpload(ownerProfileId: string, body: unknown): Promise<CreateUploadResponse> {
    const parsed = CreateUploadRequest.safeParse(body);
    if (!parsed.success) throw new DomainError("INVALID_UPLOAD", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const req = parsed.data;

    const recent = await this.db.query<{ n: string }>(
      `SELECT count(*) AS n FROM media.media WHERE owner_profile_id = $1 AND created_at > now() - interval '1 hour'`,
      [ownerProfileId],
    );
    if (Number(recent.rows[0]!.n) >= this.limits.uploadsPerHour) throw new DomainError("RATE_LIMITED", "Demasiadas subidas en la última hora", 429);

    const id = newId();
    const now = this.clock.now();
    // La clave no contiene datos personales: solo fecha e id aleatorio.
    const key = `originals/${now.toISOString().slice(0, 7)}/${id}`;
    const expiresAt = new Date(now.getTime() + this.limits.uploadUrlTtlSeconds * 1000);
    const upload = await this.storage.presignPut({ key, mime: req.mime, sizeBytes: req.sizeBytes, ttlSeconds: this.limits.uploadUrlTtlSeconds });
    await this.db.query(
      `INSERT INTO media.media (id, owner_profile_id, kind, state, delivery, captured_in_app, captured_at, duration_ms, width, height,
                                bytes, mime, sha256, storage_key_original, upload_expires_at)
       VALUES ($1, $2, $3, 'PENDING_UPLOAD', 'FILE', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [id, ownerProfileId, req.kind, req.capturedInApp, req.capturedAt ?? null, req.durationMs ?? null, req.width ?? null, req.height ?? null,
        req.sizeBytes, req.mime, req.sha256, key, expiresAt],
    );
    return { mediaId: id, upload, expiresAt: expiresAt.toISOString() };
  }

  /** El dispositivo avisa de que terminó la subida. Idempotente. */
  async completeUpload(ownerProfileId: string, mediaId: string): Promise<{ mediaId: string; state: string }> {
    const row = await this.row(this.db, mediaId);
    if (!row || row.owner_profile_id !== ownerProfileId) throw notFound("Media");
    if (row.state !== "PENDING_UPLOAD") return { mediaId, state: row.state };
    if (row.upload_expires_at && row.upload_expires_at < this.clock.now()) {
      await this.reject(this.db, mediaId, "La subida caducó");
      return { mediaId, state: "REJECTED" };
    }
    const obj = await this.storage.stat(row.storage_key_original!);
    if (!obj) throw new DomainError("UPLOAD_MISSING", "El archivo aún no está en el almacenamiento", 409);
    if (obj.size !== Number(row.bytes)) {
      await this.reject(this.db, mediaId, `Tamaño recibido ${obj.size}, declarado ${row.bytes}`);
      return { mediaId, state: "REJECTED" };
    }
    await withTransaction(this.db, async (tx) => {
      const res = await tx.query(`UPDATE media.media SET state = 'UPLOADED', updated_at = now() WHERE id = $1 AND state = 'PENDING_UPLOAD'`, [mediaId]);
      if (res.rowCount) await publish(tx, "MediaUploaded", { mediaId }, { lane: "interactive" });
    });
    return { mediaId, state: "UPLOADED" };
  }

  /** Validación y saneamiento (worker). Reintentable: solo actúa sobre media UPLOADED o PROCESSING. */
  async process(tx: Queryable, mediaId: string): Promise<void> {
    const row = await this.row(tx, mediaId);
    if (!row || !["UPLOADED", "PROCESSING"].includes(row.state)) return;
    await tx.query(`UPDATE media.media SET state = 'PROCESSING', updated_at = now() WHERE id = $1`, [mediaId]);

    const original = await this.storage.get(row.storage_key_original!);
    const sha = createHash("sha256").update(original).digest("hex");
    if (sha !== row.sha256) return this.reject(tx, mediaId, "El hash no coincide con el declarado");
    const declared = familyOfMime(row.mime);
    const actual = sniffFamily(original.subarray(0, 16));
    if (!declared || declared !== actual) return this.reject(tx, mediaId, `El contenido no es ${row.mime}`);

    let result;
    try {
      result = sanitize(declared, original);
    } catch (err) {
      if (err instanceof MalformedMediaError) return this.reject(tx, mediaId, `Archivo dañado: ${err.message}`);
      throw err;
    }
    const publicKey = `public/${mediaId}.${EXT[row.mime] ?? "bin"}`;
    await this.storage.put(publicKey, result.data, row.mime);
    await tx.query(
      `INSERT INTO media.variants (media_id, variant, storage_key, bytes, mime) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (media_id, variant) DO UPDATE SET storage_key = EXCLUDED.storage_key, bytes = EXCLUDED.bytes`,
      [mediaId, PUBLIC_VARIANT, publicKey, result.data.length, row.mime],
    );
    await tx.query(
      `UPDATE media.media SET state = 'READY', sanitized = $2, processed_at = $3, updated_at = now() WHERE id = $1`,
      [mediaId, result.removed, this.clock.now()],
    );
    await publish(tx, "MediaReady", { mediaId }, { lane: "interactive" });
  }

  /** Un reporte o post solo puede adjuntar media propia, de un tipo soportado en V1 y ya subida. */
  async assertAttachable(q: Queryable, ownerProfileId: string, mediaIds: string[]): Promise<{ id: string; kind: "IMAGE" | "VIDEO_RECORDED" }[]> {
    if (mediaIds.length === 0) return [];
    const { rows } = await q.query<{ id: string; kind: MediaKind; state: string }>(
      `SELECT id, kind, state FROM media.media WHERE id = ANY($1) AND owner_profile_id = $2`,
      [mediaIds, ownerProfileId],
    );
    if (rows.length !== new Set(mediaIds).size) throw new DomainError("MEDIA_NOT_FOUND", "Media inexistente o ajena");
    for (const r of rows) {
      if (!V1_MEDIA_KINDS.includes(r.kind)) throw new DomainError("MEDIA_KIND_UNSUPPORTED", `Tipo de media no soportado en V1: ${r.kind}`);
      if (!["UPLOADED", "PROCESSING", "READY"].includes(r.state)) throw new DomainError("MEDIA_NOT_READY", "La media aún no se ha subido");
    }
    const kinds = new Map(rows.map((r) => [r.id, r.kind as "IMAGE" | "VIDEO_RECORDED"]));
    return mediaIds.map((id) => ({ id, kind: kinds.get(id)! }));
  }

  /**
   * Vistas públicas. Solo media READY con variante saneada y no retirada por moderación. En categorías
   * sensibles (p. ej. delincuencia, D-08) además se exige aprobación de moderación hasta que exista el
   * difuminado automático de rostros y matrículas.
   */
  async publicViews(q: Queryable, mediaIds: string[], opts: { requireApproval: boolean }): Promise<MediaView[]> {
    if (mediaIds.length === 0) return [];
    const { rows } = await q.query<{
      id: string; kind: MediaKind; mime: string; width: number | null; height: number | null; duration_ms: number | null;
      captured_in_app: boolean; storage_key: string;
    }>(
      `SELECT m.id, m.kind, m.mime, m.width, m.height, m.duration_ms, m.captured_in_app, v.storage_key
         FROM media.media m JOIN media.variants v ON v.media_id = m.id AND v.variant = $2
        WHERE m.id = ANY($1) AND m.state = 'READY'
          AND (m.moderation_state = 'APPROVED' OR (m.moderation_state = 'PENDING' AND NOT $3))
        ORDER BY array_position($1::uuid[], m.id)`,
      [mediaIds, PUBLIC_VARIANT, opts.requireApproval],
    );
    return rows.map((r) => ({
      id: r.id, kind: r.kind, mime: r.mime, width: r.width, height: r.height, durationMs: r.duration_ms,
      capturedInApp: r.captured_in_app, url: this.storage.publicUrl(r.storage_key),
    }));
  }

  /** Estado para el propietario (la app consulta si su subida ya está lista). */
  async ownerState(ownerProfileId: string, mediaId: string): Promise<{ mediaId: string; state: string; rejectionReason: string | null }> {
    const { rows } = await this.db.query<{ state: string; rejection_reason: string | null }>(
      `SELECT state, rejection_reason FROM media.media WHERE id = $1 AND owner_profile_id = $2`,
      [mediaId, ownerProfileId],
    );
    if (!rows[0]) throw notFound("Media");
    return { mediaId, state: rows[0].state, rejectionReason: rows[0].rejection_reason };
  }

  /**
   * Mantenimiento diario (cost-first y privacidad):
   * - subidas nunca completadas → DELETED y se borra lo que haya llegado;
   * - originales privados de media READY → se borran tras la retención (queda la variante pública saneada y el hash).
   */
  async applyRetention(now: Date = this.clock.now()): Promise<{ abandoned: number; originalsDeleted: number }> {
    const abandoned = await this.db.query<{ id: string; storage_key_original: string }>(
      `SELECT id, storage_key_original FROM media.media WHERE state = 'PENDING_UPLOAD' AND upload_expires_at < $1::timestamptz - interval '1 hour' LIMIT 500`,
      [now],
    );
    for (const r of abandoned.rows) {
      await this.storage.delete(r.storage_key_original);
      await this.db.query(`UPDATE media.media SET state = 'DELETED', storage_key_original = NULL, updated_at = now() WHERE id = $1`, [r.id]);
    }
    const expired = await this.db.query<{ id: string; storage_key_original: string }>(
      `SELECT id, storage_key_original FROM media.media
        WHERE state = 'READY' AND storage_key_original IS NOT NULL AND processed_at < $1::timestamptz - make_interval(days => $2) LIMIT 500`,
      [now, this.limits.originalRetentionDays],
    );
    for (const r of expired.rows) {
      await this.storage.delete(r.storage_key_original);
      await this.db.query(
        `UPDATE media.media SET storage_key_original = NULL, original_deleted_at = $2, updated_at = now() WHERE id = $1`,
        [r.id, now],
      );
    }
    return { abandoned: abandoned.rows.length, originalsDeleted: expired.rows.length };
  }

  private async row(q: Queryable, id: string): Promise<MediaRow | null> {
    const { rows } = await q.query<MediaRow>(
      `SELECT id, owner_profile_id, kind, state, mime, bytes, sha256, storage_key_original, width, height, duration_ms,
              captured_in_app, upload_expires_at
         FROM media.media WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  private async reject(q: Queryable, mediaId: string, reason: string): Promise<void> {
    await q.query(`UPDATE media.media SET state = 'REJECTED', rejection_reason = $2, updated_at = now() WHERE id = $1`, [mediaId, reason]);
    await publish(q, "MediaRejected", { mediaId, reason });
  }
}
