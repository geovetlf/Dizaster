import { createHash, randomBytes } from "node:crypto";
import {
  CreateUploadRequest,
  MEDIA_UPLOAD_LIMITS,
  V1_MEDIA_KINDS,
  type ContentWarning,
  type CreateUploadResponse,
  type MediaDelivery,
  type MediaKind,
  type MediaView,
  type OriginalAccessEntry,
  type OriginalAccessGrant,
  type RedactionBox,
  DATA_EXPORT_ROW_LIMIT,
} from "@dizaster/contracts";
import type { Clock } from "../../platform/clock.js";
import { withTransaction, type Db, type Queryable } from "../../platform/db.js";
import { DomainError, notFound } from "../../platform/errors.js";
import { newId } from "../../platform/ids.js";
import { publish, type OutboxDispatcher } from "../../platform/outbox.js";
import { inProcessDecoder, type MediaDecoder } from "./decoder.js";
import { NEAR_DUPLICATE_BITS, phashBands } from "./images.js";
import { ACCEPTED_VIDEO_CODECS, familyOfMime, MalformedMediaError, sanitize, sniffFamily } from "./sanitize.js";
import type { StorageProvider } from "./storage/types.js";

export type { StorageProvider } from "./storage/types.js";
export { LocalDiskStorage } from "./storage/local.js";
export { S3Storage, type S3Config } from "./storage/s3.js";
export { inProcessDecoder, IsolatedDecoder, type MediaDecoder } from "./decoder.js";

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
  /** Cache-Control de las variantes públicas (ADR 0286). Sin valor, el del proveedor. */
  publicCacheControl?: string | undefined;
}

/** Variante pública saneada (sin metadatos de ubicación). La única que sale por la API. */
export const PUBLIC_VARIANT = "DISPLAY";
export const THUMB_VARIANT = "THUMB_S";
/** Fotograma de un video a tamaño de pantalla (ADR 0032). */
export const POSTER_VARIANT = "POSTER";
const posterKey = (originalKey: string) => `${originalKey}_poster`;
/** Una foto casi idéntica a otra de otra persona subida hace más de esto se señala a moderación. */
export const REUSE_MIN_AGE_HOURS = 1;
/** Margen sobre los 60 s (redondeo de contenedores y del grabador). */
export const VIDEO_DURATION_TOLERANCE_MS = 1_000;
/** Lado mayor máximo de un video (4K). */
export const MAX_VIDEO_SIDE_PX = 4096;

/** Originales vistos por moderación: tope por persona y hora, y vida del enlace (ADR 0168). */
export const ORIGINAL_ACCESS_PER_HOUR = 30;
export const ORIGINAL_ACCESS_TTL_SECONDS = 60;
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

const EXT: Record<string, string> = { "image/jpeg": "jpg", "video/mp4": "mp4", "video/quicktime": "mov" };

interface MediaRow {
  id: string; owner_profile_id: string; kind: MediaKind; state: string; mime: string; bytes: string; sha256: string;
  storage_key_original: string | null; width: number | null; height: number | null; duration_ms: number | null;
  captured_in_app: boolean; upload_expires_at: Date | null; poster_bytes: number | null; poster_sha256: string | null;
  redactions: RedactionBox[];
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
    /** Decodificación aislada de lo subido (ADR 0194). */
    private readonly decoder: MediaDecoder = inProcessDecoder,
  ) {}

  registerHandlers(dispatcher: OutboxDispatcher): void {
    dispatcher.on("MediaUploaded", "media.process", async (e, tx) => {
      await this.process(tx, e.payload.mediaId);
    });
    dispatcher.on("AccountDeleted", "media.purge-account", async (e, tx) => {
      await this.purgeOwner(tx, e.payload.profileId);
    });
  }

  /**
   * Borrado de cuenta: se eliminan del almacenamiento el original y todas las variantes públicas de cada media
   * de la persona, y la fila queda DELETED sin claves (el hash se conserva para detectar re-subidas abusivas).
   * Borrar un objeto es idempotente: si la transacción se reintenta, repetirlo no hace daño.
   */
  async purgeOwner(q: Queryable, ownerProfileId: string): Promise<number> {
    return this.purgeWhere(q, "m.owner_profile_id = $1", ownerProfileId);
  }

  /** La persona borró el post: sus fotos y videos se eliminan igual que al borrar la cuenta (ADR 0027). */
  async purgeMedia(q: Queryable, mediaIds: string[]): Promise<number> {
    if (mediaIds.length === 0) return 0;
    return this.purgeWhere(q, "m.id = ANY($1)", mediaIds);
  }

  private async purgeWhere(q: Queryable, where: string, param: unknown): Promise<number> {
    const { rows } = await q.query<{ id: string; storage_key_original: string | null; poster: boolean; keys: string[] }>(
      `SELECT m.id, m.storage_key_original, m.poster_sha256 IS NOT NULL AS poster, COALESCE(array_agg(v.storage_key) FILTER (WHERE v.storage_key IS NOT NULL), '{}') AS keys
         FROM media.media m LEFT JOIN media.variants v ON v.media_id = m.id
        WHERE ${where} AND (m.state <> 'DELETED' OR m.storage_key_original IS NOT NULL OR v.media_id IS NOT NULL)
        GROUP BY m.id`,
      [param],
    );
    for (const r of rows) {
      const posterOriginal = r.poster && r.storage_key_original ? posterKey(r.storage_key_original) : null;
      for (const key of [r.storage_key_original, posterOriginal, ...r.keys]) if (key) await this.storage.delete(key);
      await q.query(`DELETE FROM media.variants WHERE media_id = $1`, [r.id]);
      await q.query(
        `UPDATE media.media SET state = 'DELETED', storage_key_original = NULL, capture_h3_r9 = NULL, updated_at = now() WHERE id = $1`,
        [r.id],
      );
    }
    return rows.length;
  }

  /**
   * `dailyBytes` (ADR 0072): tope de bytes subidos en 24 h por la cuenta, ya ajustado por reputación. Cuenta lo
   * pedido que no fue rechazado, incluida esta subida. `phoneId` (ADR 0207): los cupos por hora y por día se
   * comparten entre todas las cuentas del mismo teléfono.
   */
  async createUpload(ownerProfileId: string, body: unknown, dailyBytes: number = Number.POSITIVE_INFINITY, phoneId: string | null = null): Promise<CreateUploadResponse> {
    const parsed = CreateUploadRequest.safeParse(body);
    if (!parsed.success) throw new DomainError("INVALID_UPLOAD", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const req = parsed.data;

    const recent = await this.db.query<{ n: string }>(
      `SELECT greatest(count(*) FILTER (WHERE owner_profile_id = $1), count(*) FILTER (WHERE phone_id = $2)) AS n
         FROM media.media WHERE (owner_profile_id = $1 OR phone_id = $2) AND created_at > now() - interval '1 hour'`,
      [ownerProfileId, phoneId],
    );
    if (Number(recent.rows[0]!.n) >= this.limits.uploadsPerHour) throw new DomainError("RATE_LIMITED", "Demasiadas subidas en la última hora", 429);
    if (Number.isFinite(dailyBytes)) {
      const day = await this.db.query<{ b: string }>(
        `SELECT greatest(coalesce(sum(bytes + coalesce(poster_bytes, 0)) FILTER (WHERE owner_profile_id = $1), 0),
                         coalesce(sum(bytes + coalesce(poster_bytes, 0)) FILTER (WHERE phone_id = $2), 0)) AS b
           FROM media.media
          WHERE (owner_profile_id = $1 OR phone_id = $2) AND created_at > now() - interval '24 hours' AND state NOT IN ('REJECTED', 'DELETED')`,
        [ownerProfileId, phoneId],
      );
      if (Number(day.rows[0]!.b) + req.sizeBytes + (req.poster?.sizeBytes ?? 0) > dailyBytes) {
        throw new DomainError("DAILY_UPLOAD_QUOTA", "Llegaste al máximo de datos subidos en 24 horas", 429);
      }
    }

    const id = newId();
    const now = this.clock.now();
    // La clave no contiene datos personales: solo fecha e id aleatorio.
    const key = `originals/${now.toISOString().slice(0, 7)}/${id}`;
    const expiresAt = new Date(now.getTime() + this.limits.uploadUrlTtlSeconds * 1000);
    const upload = await this.storage.presignPut({ key, mime: req.mime, sizeBytes: req.sizeBytes, ttlSeconds: this.limits.uploadUrlTtlSeconds });
    const posterUpload = req.poster
      ? await this.storage.presignPut({ key: posterKey(key), mime: "image/jpeg", sizeBytes: req.poster.sizeBytes, ttlSeconds: this.limits.uploadUrlTtlSeconds })
      : null;
    await this.db.query(
      `INSERT INTO media.media (id, owner_profile_id, kind, state, delivery, captured_in_app, captured_at, duration_ms, width, height,
                                bytes, mime, sha256, storage_key_original, upload_expires_at, poster_bytes, poster_sha256, content_warning, redactions, phone_id)
       VALUES ($1, $2, $3, 'PENDING_UPLOAD', 'FILE', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [id, ownerProfileId, req.kind, req.capturedInApp, req.capturedAt ?? null, req.durationMs ?? null, req.width ?? null, req.height ?? null,
        req.sizeBytes, req.mime, req.sha256, key, expiresAt, req.poster?.sizeBytes ?? null, req.poster?.sha256 ?? null, req.graphic ? "GRAPHIC" : null, JSON.stringify(req.redactions), phoneId],
    );
    return { mediaId: id, upload, ...(posterUpload ? { posterUpload } : {}), expiresAt: expiresAt.toISOString() };
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
      result = await this.decoder.sanitize(declared, original);
    } catch (err) {
      if (err instanceof MalformedMediaError) return this.reject(tx, mediaId, `Archivo dañado: ${err.message}`);
      throw err;
    }
    const variant = async (name: string, key: string, data: Uint8Array, mime: string) => {
      await this.storage.put(key, data, mime, this.limits.publicCacheControl ? { cacheControl: this.limits.publicCacheControl } : undefined);
      await tx.query(
        `INSERT INTO media.variants (media_id, variant, storage_key, bytes, mime) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (media_id, variant) DO UPDATE SET storage_key = EXCLUDED.storage_key, bytes = EXCLUDED.bytes, mime = EXCLUDED.mime`,
        [mediaId, name, key, data.length, mime],
      );
    };

    if (declared === "image/jpeg") {
      // Fotos: se re-codifican (sin ningún metadato) a un tamaño de pantalla y a miniatura, y se calcula el
      // hash perceptual. Lo que no se puede decodificar se rechaza.
      let img;
      try {
        img = await this.decoder.renderImage(original, row.redactions);
      } catch (err) {
        if (err instanceof MalformedMediaError) return this.reject(tx, mediaId, err.message);
        throw err;
      }
      for (const v of img.variants) {
        await variant(v.variant, v.variant === PUBLIC_VARIANT ? `public/${mediaId}.jpg` : `public/${mediaId}_${v.variant.toLowerCase()}.jpg`, v.data, "image/jpeg");
      }
      await tx.query(
        `UPDATE media.media SET width = $2, height = $3, phash = $4, phash_bands = $5 WHERE id = $1`,
        [mediaId, img.width, img.height, img.phash, phashBands(img.phash)],
      );
      await this.detectReuse(tx, mediaId, row.owner_profile_id, img.phash);
    } else {
      // Duración y tamaño salen del archivo, no de lo declarado (ADR 0071).
      let info;
      try {
        info = await this.decoder.videoInfo(original);
      } catch (err) {
        if (err instanceof MalformedMediaError) return this.reject(tx, mediaId, `Video ilegible: ${err.message}`);
        throw err;
      }
      // Sin transcodificar (§12.1, ADR 0163): lo que no se pueda reproducir tal cual en Android e iOS no se publica.
      if (!info.codec || !ACCEPTED_VIDEO_CODECS.has(info.codec)) return this.reject(tx, mediaId, `Códec de video no admitido: ${info.codec ?? "sin pista de video"}`);
      const maxMs = MEDIA_UPLOAD_LIMITS.VIDEO_RECORDED.maxDurationMs + VIDEO_DURATION_TOLERANCE_MS;
      if (info.durationMs <= 0 || info.durationMs > maxMs) return this.reject(tx, mediaId, `Duración real ${info.durationMs} ms fuera del límite`);
      if (info.width !== null && info.height !== null && Math.max(info.width, info.height) > MAX_VIDEO_SIDE_PX) {
        return this.reject(tx, mediaId, `Resolución ${info.width}×${info.height} por encima del máximo`);
      }
      await tx.query(
        `UPDATE media.media SET duration_ms = $2, width = coalesce($3, width), height = coalesce($4, height), codec = $5 WHERE id = $1`,
        [mediaId, info.durationMs, info.width, info.height, info.codec],
      );
      await variant(PUBLIC_VARIANT, `public/${mediaId}.${EXT[row.mime] ?? "bin"}`, result.data, row.mime);
      if (row.poster_sha256) await this.processPoster(tx, row, variant);
    }
    await tx.query(
      `UPDATE media.media SET state = 'READY', sanitized = $2, processed_at = $3, updated_at = now() WHERE id = $1`,
      [mediaId, result.removed, this.clock.now()],
    );
    const hash = (await tx.query<{ phash: string | null }>(`SELECT phash FROM media.media WHERE id = $1`, [mediaId])).rows[0]?.phash ?? null;
    // Igual a contenido ya retirado por moderación (ADR 0145): queda oculta y va a revisión; nunca se rechaza sola.
    const blocked = await this.blockedMatch(tx, mediaId, sha, hash);
    if (blocked) {
      await tx.query(`UPDATE media.media SET moderation_state = 'HELD', blocked_match_of = $2 WHERE id = $1`, [mediaId, blocked]);
      await publish(tx, "BlockedMediaMatched", { mediaId });
    }
    await publish(tx, "MediaReady", { mediaId, phash: hash }, { lane: "interactive" });
  }

  /**
   * Póster del video (ADR 0032): se trata como una foto (hash, re-codificación sin metadatos, miniatura) y su
   * hash perceptual pasa a ser el del video, así un video reciclado también se detecta. Un póster ausente,
   * alterado o ilegible no rechaza el video: solo se queda sin miniatura.
   */
  private async processPoster(
    tx: Queryable, row: MediaRow, variant: (name: string, key: string, data: Uint8Array, mime: string) => Promise<void>,
  ): Promise<void> {
    const key = posterKey(row.storage_key_original!);
    const stat = await this.storage.stat(key);
    if (!stat || stat.size !== row.poster_bytes) return;
    const data = await this.storage.get(key);
    const img = await this.renderPoster(data, row.poster_sha256!);
    // Solo se borra cuando ya no hace falta reintentar (un error inesperado deja el original para el reintento).
    await this.storage.delete(key);
    if (!img) return;
    for (const v of img.variants) {
      const name = v.variant === PUBLIC_VARIANT ? POSTER_VARIANT : v.variant;
      await variant(name, `public/${row.id}_${name.toLowerCase()}.jpg`, v.data, "image/jpeg");
    }
    await tx.query(`UPDATE media.media SET phash = $2, phash_bands = $3 WHERE id = $1`, [row.id, img.phash, phashBands(img.phash)]);
    await this.detectReuse(tx, row.id, row.owner_profile_id, img.phash);
  }

  private async renderPoster(data: Uint8Array, sha256: string) {
    if (createHash("sha256").update(data).digest("hex") !== sha256 || sniffFamily(data.subarray(0, 16)) !== "image/jpeg") return null;
    try {
      return await this.decoder.renderImage(data);
    } catch (err) {
      if (err instanceof MalformedMediaError) return null;
      throw err;
    }
  }

  /**
   * ¿Esta foto ya se había subido? Busca por bandas del hash perceptual (índice GIN) y confirma la distancia.
   * Se guarda la más antigua como `duplicate_of`. Si era de otra persona y de hace más de una hora, avisa
   * (MediaReuseDetected) para que moderación revise una posible foto reciclada de otro suceso. Nunca rechaza.
   */
  private async detectReuse(tx: Queryable, mediaId: string, ownerProfileId: string, phash: string): Promise<void> {
    const { rows } = await tx.query<{ id: string; owner_profile_id: string; old: boolean }>(
      `SELECT id, owner_profile_id, created_at < now() - make_interval(hours => $5) AS old
         FROM media.media
        WHERE phash_bands && $2 AND state = 'READY' AND id <> $1
          AND bit_count(('x' || phash)::bit(64) # ('x' || $3)::bit(64)) <= $4
        ORDER BY created_at, id LIMIT 1`,
      [mediaId, phashBands(phash), phash, NEAR_DUPLICATE_BITS, REUSE_MIN_AGE_HOURS],
    );
    const earlier = rows[0];
    if (!earlier) return;
    const suspected = earlier.owner_profile_id !== ownerProfileId && earlier.old;
    await tx.query(`UPDATE media.media SET duplicate_of = $2, reuse_suspected = $3 WHERE id = $1`, [mediaId, earlier.id, suspected]);
    if (suspected) await publish(tx, "MediaReuseDetected", { mediaId });
  }

  // ───────────── Lista de hashes de contenido retirado (ADR 0145) ─────────────

  /** Moderación retiró contenido con esta media: sus hashes (nunca la imagen) pasan a la lista. Idempotente. */
  async blockHashes(q: Queryable, mediaIds: string[]): Promise<number> {
    if (mediaIds.length === 0) return 0;
    const r = await q.query(
      `INSERT INTO media.blocked_hashes (media_id, sha256, phash, phash_bands)
       SELECT id, sha256, phash, phash_bands FROM media.media WHERE id = ANY($1)
       ON CONFLICT (media_id) DO NOTHING`,
      [mediaIds],
    );
    return r.rowCount ?? 0;
  }

  /** Restaurar (apelación aceptada): los hashes salen de la lista. */
  async unblockHashes(q: Queryable, mediaIds: string[]): Promise<number> {
    if (mediaIds.length === 0) return 0;
    return (await q.query(`DELETE FROM media.blocked_hashes WHERE media_id = ANY($1)`, [mediaIds])).rowCount ?? 0;
  }

  /** Media de la lista a la que esta se parece: SHA-256 idéntico o hash perceptual casi igual. */
  private async blockedMatch(q: Queryable, mediaId: string, sha: string, phash: string | null): Promise<string | null> {
    const { rows } = await q.query<{ media_id: string }>(
      `SELECT media_id FROM media.blocked_hashes
        WHERE media_id <> $1 AND (sha256 = $2 OR ($3::text IS NOT NULL AND phash_bands && $4
          AND bit_count(('x' || phash)::bit(64) # ('x' || $3)::bit(64)) <= $5))
        ORDER BY created_at LIMIT 1`,
      [mediaId, sha, phash, phash ? phashBands(phash) : [], NEAR_DUPLICATE_BITS],
    );
    return rows[0]?.media_id ?? null;
  }

  /** De estas media, cuáles quedaron retenidas por coincidir con contenido retirado (el post avisa a moderación). */
  async heldByBlocklist(q: Queryable, mediaIds: string[]): Promise<string[]> {
    if (mediaIds.length === 0) return [];
    const { rows } = await q.query<{ id: string }>(`SELECT id FROM media.media WHERE id = ANY($1) AND moderation_state = 'HELD'`, [mediaIds]);
    return rows.map((r) => r.id);
  }

  /** De estas media, cuáles parecen una foto reciclada (el reporte avisa a moderación al adjuntarlas). */
  /** Hash perceptual de las fotos ya procesadas (para la deduplicación de EVENTs). */
  async phashes(q: Queryable, mediaIds: string[]): Promise<string[]> {
    if (mediaIds.length === 0) return [];
    const { rows } = await q.query<{ phash: string }>(
      `SELECT phash FROM media.media WHERE id = ANY($1) AND state = 'READY' AND phash IS NOT NULL`, [mediaIds],
    );
    return rows.map((r) => r.phash);
  }

  async reuseSuspected(q: Queryable, mediaIds: string[]): Promise<string[]> {
    if (mediaIds.length === 0) return [];
    const { rows } = await q.query<{ id: string }>(`SELECT id FROM media.media WHERE id = ANY($1) AND reuse_suspected`, [mediaIds]);
    return rows.map((r) => r.id);
  }

  /** Un reporte o post solo puede adjuntar media propia, de un tipo soportado en V1 y ya subida. */
  /**
   * `requireInAppCapture` (reportes, D-10, ADR 0166): solo media capturada con la cámara de la app; una foto o video de
   * la galería puede ser antiguo o de otro lugar. Los posts siguen admitiendo galería.
   */
  async assertAttachable(q: Queryable, ownerProfileId: string, mediaIds: string[], opts: { requireInAppCapture?: boolean } = {}): Promise<{ id: string; kind: "IMAGE" | "VIDEO_RECORDED" }[]> {
    if (mediaIds.length === 0) return [];
    const { rows } = await q.query<{ id: string; kind: MediaKind; state: string; captured_in_app: boolean }>(
      `SELECT id, kind, state, captured_in_app FROM media.media WHERE id = ANY($1) AND owner_profile_id = $2`,
      [mediaIds, ownerProfileId],
    );
    if (rows.length !== new Set(mediaIds).size) throw new DomainError("MEDIA_NOT_FOUND", "Media inexistente o ajena");
    for (const r of rows) {
      if (!V1_MEDIA_KINDS.includes(r.kind)) throw new DomainError("MEDIA_KIND_UNSUPPORTED", `Tipo de media no soportado en V1: ${r.kind}`);
      if (!["UPLOADED", "PROCESSING", "READY"].includes(r.state)) throw new DomainError("MEDIA_NOT_READY", "La media aún no se ha subido");
      if (opts.requireInAppCapture && !r.captured_in_app) {
        throw new DomainError("MEDIA_NOT_CAPTURED_IN_APP", "En un reporte solo van fotos o videos tomados con la cámara de la app");
      }
    }
    const kinds = new Map(rows.map((r) => [r.id, r.kind as "IMAGE" | "VIDEO_RECORDED"]));
    return mediaIds.map((id) => ({ id, kind: kinds.get(id)! }));
  }

  /**
   * Original privado para moderación (§13.1, ADR 0168): con motivo, límite por hora y registro de solo inserción.
   * Devuelve una ruta de un solo uso lógico que vale 60 s; el archivo se sirve sin metadatos (nunca el GPS del
   * teléfono) pero sin el difuminado que la persona aplicó, que es lo que moderación necesita revisar.
   */
  async grantOriginalAccess(mediaId: string, actorUserId: string, reason: string, caseId: string | null): Promise<OriginalAccessGrant> {
    return withTransaction(this.db, async (tx) => {
      await tx.query(`SELECT pg_advisory_xact_lock(hashtext('media-original:' || $1))`, [actorUserId]);
      const recent = (await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM media.original_access_log WHERE actor_user_id = $1 AND accessed_at > now() - interval '1 hour'`, [actorUserId],
      )).rows[0]!.n;
      if (recent >= ORIGINAL_ACCESS_PER_HOUR) throw new DomainError("RATE_LIMITED", "Demasiados originales vistos en una hora", 429);
      const m = (await tx.query<{ mime: string; storage_key_original: string | null }>(
        `SELECT mime, storage_key_original FROM media.media WHERE id = $1 AND state IN ('READY','REJECTED')`, [mediaId],
      )).rows[0];
      if (!m) throw notFound("Media");
      if (!m.storage_key_original) throw new DomainError("ORIGINAL_GONE", "El original ya se borró por retención", 410);
      const token = randomBytes(24).toString("base64url");
      const expiresAt = new Date(this.clock.now().getTime() + ORIGINAL_ACCESS_TTL_SECONDS * 1000);
      await tx.query(
        `INSERT INTO media.original_access_log (id, media_id, actor_user_id, reason, case_id, token_hash, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [newId(), mediaId, actorUserId, reason, caseId, tokenHash(token), expiresAt],
      );
      return { path: `/v1/moderation/media-originals/${token}`, mime: m.mime, expiresAt: expiresAt.toISOString() };
    });
  }

  /** Lee el original de un permiso vigente, sin metadatos. `null` si el permiso no existe o venció. */
  async readOriginal(token: string): Promise<{ data: Uint8Array; mime: string } | null> {
    const { rows } = await this.db.query<{ mime: string; storage_key_original: string | null }>(
      `SELECT m.mime, m.storage_key_original FROM media.original_access_log l JOIN media.media m ON m.id = l.media_id
        WHERE l.token_hash = $1 AND l.expires_at > $2`,
      [tokenHash(token), this.clock.now()],
    );
    const r = rows[0];
    if (!r?.storage_key_original) return null;
    const family = familyOfMime(r.mime);
    if (!family) return null;
    const original = await this.storage.get(r.storage_key_original);
    return { data: sanitize(family, original).data, mime: r.mime };
  }

  /** Accesos a originales, más recientes primero, con filtros y cursor (id UUIDv7 de la última entrada; ADR 0239). */
  async originalAccessLog(f: { mediaId?: string; actorUserId?: string; cursor?: string; limit: number }): Promise<{ entries: OriginalAccessEntry[]; nextCursor: string | null }> {
    const { rows } = await this.db.query<{ id: string; media_id: string; actor_user_id: string; reason: string; case_id: string | null; accessed_at: Date }>(
      `SELECT id, media_id, actor_user_id, reason, case_id, accessed_at FROM media.original_access_log
        WHERE ($1::uuid IS NULL OR media_id = $1) AND ($2::uuid IS NULL OR actor_user_id = $2) AND ($3::uuid IS NULL OR id < $3)
        ORDER BY id DESC LIMIT $4`,
      [f.mediaId ?? null, f.actorUserId ?? null, f.cursor ?? null, f.limit + 1],
    );
    const page = rows.slice(0, f.limit);
    return {
      entries: page.map((r) => ({ id: r.id, mediaId: r.media_id, actorUserId: r.actor_user_id, reason: r.reason, caseId: r.case_id, accessedAt: r.accessed_at.toISOString() })),
      nextCursor: rows.length > f.limit ? page[page.length - 1]!.id : null,
    };
  }

  /** SHA-256 declarados (y verificados al procesar) de la media, para cotejar con la firma de la captura (ADR 0129). */
  async sha256Of(q: Queryable, mediaIds: string[]): Promise<string[]> {
    if (mediaIds.length === 0) return [];
    const { rows } = await q.query<{ sha256: string }>(`SELECT sha256 FROM media.media WHERE id = ANY($1)`, [mediaIds]);
    return rows.map((r) => r.sha256);
  }

  /**
   * Pruebas de captura para la presencia (ADR 0073): de la media ya validada por `assertAttachable`, la que la app
   * capturó con su cámara, con la hora declarada y la hora en que el servidor vio la subida.
   */
  async inAppCaptures(q: Queryable, ownerProfileId: string, mediaIds: string[]): Promise<{ mediaId: string; kind: string; capturedAt: Date; serverSeenAt: Date }[]> {
    if (mediaIds.length === 0) return [];
    const { rows } = await q.query<{ id: string; kind: string; captured_at: Date; created_at: Date }>(
      `SELECT id, kind, captured_at, created_at FROM media.media
        WHERE id = ANY($1) AND owner_profile_id = $2 AND captured_in_app AND captured_at IS NOT NULL ORDER BY captured_at, id`,
      [mediaIds, ownerProfileId],
    );
    return rows.map((r) => ({ mediaId: r.id, kind: r.kind, capturedAt: r.captured_at, serverSeenAt: r.created_at }));
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
      captured_in_app: boolean; storage_key: string; thumb_key: string | null; poster_key: string | null; display_mime: string;
      content_warning: ContentWarning | null;
    }>(
      `SELECT m.id, m.kind, m.mime, m.width, m.height, m.duration_ms, m.captured_in_app, v.storage_key, v.mime AS display_mime, m.content_warning,
              t.storage_key AS thumb_key, po.storage_key AS poster_key
         FROM media.media m JOIN media.variants v ON v.media_id = m.id AND v.variant = $2
         LEFT JOIN media.variants t ON t.media_id = m.id AND t.variant = $4
         LEFT JOIN media.variants po ON po.media_id = m.id AND po.variant = $5
        WHERE m.id = ANY($1) AND m.state = 'READY'
          AND (m.moderation_state = 'APPROVED' OR (m.moderation_state = 'PENDING' AND NOT $3))
        ORDER BY array_position($1::uuid[], m.id)`,
      [mediaIds, PUBLIC_VARIANT, opts.requireApproval, THUMB_VARIANT, POSTER_VARIANT],
    );
    return rows.map((r) => ({
      id: r.id, kind: r.kind, mime: r.display_mime, width: r.width, height: r.height, durationMs: r.duration_ms,
      capturedInApp: r.captured_in_app, url: this.storage.publicUrl(r.storage_key),
      thumbUrl: r.thumb_key ? this.storage.publicUrl(r.thumb_key) : null,
      posterUrl: r.poster_key ? this.storage.publicUrl(r.poster_key) : null,
      contentWarning: r.content_warning,
    }));
  }

  /** Moderación (ADR 0035): media que esperaba aprobación en una categoría sensible pasa a mostrarse. */
  async approve(q: Queryable, mediaIds: string[]): Promise<number> {
    if (mediaIds.length === 0) return 0;
    // También la retenida por la lista de hashes (ADR 0145): una persona decidió que puede mostrarse.
    const res = await q.query(`UPDATE media.media SET moderation_state = 'APPROVED', updated_at = now() WHERE id = ANY($1) AND moderation_state IN ('PENDING','HELD')`, [mediaIds]);
    return res.rowCount ?? 0;
  }

  /** Moderación (ADR 0035): se muestra difuminada con aviso hasta que la persona toque para verla. */
  async markGraphic(q: Queryable, mediaIds: string[]): Promise<void> {
    if (mediaIds.length === 0) return;
    await q.query(`UPDATE media.media SET content_warning = 'GRAPHIC', updated_at = now() WHERE id = ANY($1)`, [mediaIds]);
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

  /** Bytes guardados hoy en el almacenamiento de objetos (originales vigentes + variantes): base del costo de media. */
  async storedBytes(q: Queryable): Promise<number> {
    const { rows } = await q.query<{ n: string | null }>(
      `SELECT (SELECT COALESCE(sum(bytes), 0) FROM media.media WHERE storage_key_original IS NOT NULL AND state NOT IN ('PENDING_UPLOAD','DELETED'))
            + (SELECT COALESCE(sum(v.bytes), 0) FROM media.variants v JOIN media.media m ON m.id = v.media_id WHERE m.state <> 'DELETED') AS n`,
    );
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * Mantenimiento diario (cost-first y privacidad):
   * - subidas nunca completadas → DELETED y se borra lo que haya llegado;
   * - originales privados de media READY → se borran tras la retención (queda la variante pública saneada y el hash).
   */
  async applyRetention(now: Date = this.clock.now(), batch = 500): Promise<{ abandoned: number; originalsDeleted: number }> {
    const abandoned = await this.db.query<{ id: string; storage_key_original: string }>(
      `SELECT id, storage_key_original FROM media.media WHERE state = 'PENDING_UPLOAD' AND upload_expires_at < $1::timestamptz - interval '1 hour' LIMIT 500`,
      [now],
    );
    for (const r of abandoned.rows) {
      await this.storage.delete(r.storage_key_original);
      await this.storage.delete(posterKey(r.storage_key_original));
      await this.db.query(`UPDATE media.media SET state = 'DELETED', storage_key_original = NULL, updated_at = now() WHERE id = $1`, [r.id]);
    }
    // Originales vencidos en lotes hasta vaciar (ADR 0248), con tope de tiempo. Un fallo del almacenamiento corta la
    // pasada (lo registra el worker) y se reintenta al día siguiente.
    let originalsDeleted = 0;
    const started = Date.now();
    for (;;) {
      const expired = await this.db.query<{ id: string; storage_key_original: string }>(
        `SELECT id, storage_key_original FROM media.media
          WHERE state = 'READY' AND storage_key_original IS NOT NULL AND processed_at < $1::timestamptz - make_interval(days => $2) LIMIT $3`,
        [now, this.limits.originalRetentionDays, batch],
      );
      for (const r of expired.rows) {
        await this.storage.delete(r.storage_key_original);
        await this.db.query(
          `UPDATE media.media SET storage_key_original = NULL, original_deleted_at = $2, updated_at = now() WHERE id = $1`,
          [r.id, now],
        );
      }
      originalsDeleted += expired.rows.length;
      if (expired.rows.length < batch || Date.now() - started > 5 * 60_000) break;
    }
    // El teléfono solo sirve para el cupo de 24 h (ADR 0207): no se guarda más de 2 días.
    await this.db.query(`UPDATE media.media SET phone_id = NULL WHERE phone_id IS NOT NULL AND created_at < $1::timestamptz - interval '2 days'`, [now]);
    return { abandoned: abandoned.rows.length, originalsDeleted };
  }

  private async row(q: Queryable, id: string): Promise<MediaRow | null> {
    const { rows } = await q.query<MediaRow>(
      `SELECT id, owner_profile_id, kind, state, mime, bytes, sha256, storage_key_original, width, height, duration_ms,
              captured_in_app, upload_expires_at, poster_bytes, poster_sha256, redactions
         FROM media.media WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  private async reject(q: Queryable, mediaId: string, reason: string): Promise<void> {
    await q.query(`UPDATE media.media SET state = 'REJECTED', rejection_reason = $2, updated_at = now() WHERE id = $1`, [mediaId, reason]);
    await publish(q, "MediaRejected", { mediaId, reason });
  }
  // ───────────── Exportación de datos personales (ADR 0038) ─────────────

  /** Mis fotos y videos: metadatos y el enlace a la copia pública saneada (el original privado no sale). */
  async exportData(q: Queryable, profileId: string): Promise<Record<string, unknown[]>> {
    const { rows } = await q.query<{ id: string; kind: string; state: string; mime: string; bytes: string; captured_in_app: boolean;
      captured_at: Date | null; created_at: Date; moderation_state: string; content_warning: string | null; storage_key: string | null }>(
      `SELECT m.id, m.kind, m.state, m.mime, m.bytes, m.captured_in_app, m.captured_at, m.created_at, m.moderation_state, m.content_warning, v.storage_key
         FROM media.media m LEFT JOIN media.variants v ON v.media_id = m.id AND v.variant = $2
        WHERE m.owner_profile_id = $1 ORDER BY m.created_at DESC LIMIT ${DATA_EXPORT_ROW_LIMIT + 1}`,
      [profileId, PUBLIC_VARIANT],
    );
    return {
      media: rows.map(({ storage_key, ...r }) => ({ ...r, url: storage_key && r.state === "READY" ? this.storage.publicUrl(storage_key) : null })),
    };
  }
}
