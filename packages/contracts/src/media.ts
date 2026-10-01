import { z } from "zod";

/**
 * Tipos de media. La V1 implementa IMAGE y VIDEO_RECORDED.
 * LIVE_STREAM, AUDIO, DOCUMENT y SENSOR_FEED existen desde ya para no reconstruir el modelo.
 */
export const MediaKind = z.enum(["IMAGE", "VIDEO_RECORDED", "LIVE_STREAM", "AUDIO", "DOCUMENT", "SENSOR_FEED"]);
export type MediaKind = z.infer<typeof MediaKind>;

export const MediaState = z.enum([
  "PENDING_UPLOAD",
  "UPLOADED",
  "PROCESSING",
  "READY",
  "REJECTED",
  "LIVE",
  "ENDED",
  "VOD_READY",
  "DELETED",
]);
export type MediaState = z.infer<typeof MediaState>;

export const MediaDelivery = z.enum(["FILE", "HLS", "LL_HLS", "WEBRTC"]);
export type MediaDelivery = z.infer<typeof MediaDelivery>;

export const V1_MEDIA_KINDS: readonly MediaKind[] = ["IMAGE", "VIDEO_RECORDED"];

/**
 * Límites de subida por tipo (V1). La app comprime antes de subir; el servidor rechaza lo que exceda.
 * Las fotos se suben siempre como JPEG re-codificado en el dispositivo (sin EXIF); los videos, como MP4/MOV.
 */
export const MEDIA_UPLOAD_LIMITS = {
  IMAGE: { mimes: ["image/jpeg"], maxBytes: 8 * 1024 * 1024, maxDurationMs: null },
  VIDEO_RECORDED: { mimes: ["video/mp4", "video/quicktime"], maxBytes: 60 * 1024 * 1024, maxDurationMs: 60_000 },
} as const satisfies Record<string, { mimes: readonly string[]; maxBytes: number; maxDurationMs: number | null }>;

export type UploadableMediaKind = keyof typeof MEDIA_UPLOAD_LIMITS;

export const ContentWarning = z.enum(["GRAPHIC"]);
export type ContentWarning = z.infer<typeof ContentWarning>;

/**
 * Póster de un video (ADR 0032): un fotograma JPEG que el teléfono extrae y sube junto al video. El servidor
 * no decodifica video (sin ffmpeg): re-codifica el póster como una foto más y lo usa de miniatura.
 */
export const VIDEO_POSTER_MAX_BYTES = 1024 * 1024;
export const VideoPoster = z.object({
  sizeBytes: z.number().int().positive().max(VIDEO_POSTER_MAX_BYTES),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type VideoPoster = z.infer<typeof VideoPoster>;

/**
 * Zona a difuminar (rostro, matrícula), en fracciones del ancho/alto de la foto ya orientada (ADR 0042).
 * El servidor la aplica a todas las variantes públicas; el original privado se borra al acabar la retención.
 */
export const RedactionBox = z
  .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().gt(0).max(1), h: z.number().gt(0).max(1) })
  .refine((b) => b.x + b.w <= 1.0001 && b.y + b.h <= 1.0001, "El recuadro se sale de la foto");
export type RedactionBox = z.infer<typeof RedactionBox>;
export const MAX_REDACTIONS = 20;

export const CreateUploadRequest = z
  .object({
    kind: z.enum(["IMAGE", "VIDEO_RECORDED"]),
    mime: z.string().max(100),
    sizeBytes: z.number().int().positive(),
    /** SHA-256 del archivo en hexadecimal: el almacenamiento lo verifica al recibirlo. */
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    width: z.number().int().positive().max(20_000).optional(),
    height: z.number().int().positive().max(20_000).optional(),
    durationMs: z.number().int().positive().optional(),
    capturedAt: z.iso.datetime().optional(),
    /** Capturada con la cámara dentro de la app (más valor probatorio que una foto de la galería). */
    capturedInApp: z.boolean().default(false),
    /** Quien sube avisa de que puede impactar (heridos, violencia): se muestra difuminado hasta tocar (ADR 0035). */
    graphic: z.boolean().default(false),
    /** Solo videos. Opcional: sin póster el video se muestra con un marco genérico. */
    poster: VideoPoster.optional(),
    /** Solo fotos: rostros y matrículas que quien sube quiere difuminar. */
    redactions: z.array(RedactionBox).max(MAX_REDACTIONS).default([]),
  })
  .superRefine((v, ctx) => {
    // Difuminar un video fotograma a fotograma no está en V1: aceptarlo daría una falsa sensación de protección.
    if (v.redactions.length > 0 && v.kind !== "IMAGE") ctx.addIssue({ code: "custom", path: ["redactions"], message: "Solo se puede difuminar en fotos" });
    if (v.poster && v.kind !== "VIDEO_RECORDED") ctx.addIssue({ code: "custom", path: ["poster"], message: "Solo los videos llevan póster" });
    const limits = MEDIA_UPLOAD_LIMITS[v.kind];
    if (!(limits.mimes as readonly string[]).includes(v.mime)) ctx.addIssue({ code: "custom", path: ["mime"], message: `Tipo no admitido para ${v.kind}` });
    if (v.sizeBytes > limits.maxBytes) ctx.addIssue({ code: "custom", path: ["sizeBytes"], message: `Máximo ${limits.maxBytes} bytes` });
    if (limits.maxDurationMs !== null) {
      if (v.durationMs === undefined) ctx.addIssue({ code: "custom", path: ["durationMs"], message: "Duración obligatoria en videos" });
      else if (v.durationMs > limits.maxDurationMs) ctx.addIssue({ code: "custom", path: ["durationMs"], message: `Máximo ${limits.maxDurationMs} ms` });
    }
  });
export type CreateUploadRequest = z.infer<typeof CreateUploadRequest>;

export interface UploadInstruction {
  method: "PUT";
  url: string;
  /** Cabeceras que el cliente debe enviar tal cual: forman parte de la firma. */
  headers: Record<string, string>;
}

export interface CreateUploadResponse {
  mediaId: string;
  upload: UploadInstruction;
  /** Solo si se declaró un póster: se sube como image/jpeg antes de completar. */
  posterUpload?: UploadInstruction;
  expiresAt: string;
}

/** Vista pública: solo variantes saneadas (sin metadatos de ubicación). Nunca expone el original. */
export interface MediaView {
  id: string;
  kind: MediaKind;
  mime: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  capturedInApp: boolean;
  /** Versión para pantalla (fotos: re-codificada, máx. 1600 px, sin metadatos). */
  url: string;
  /** Miniatura (máx. 400 px) para listas y mosaicos; en videos, la del póster (null si no se subió). */
  thumbUrl: string | null;
  /** Solo videos: fotograma a tamaño de pantalla para mostrar antes de reproducir. */
  posterUrl: string | null;
  /** GRAPHIC: la app la muestra difuminada con aviso hasta que la persona toque para verla (ADR 0035). */
  contentWarning: ContentWarning | null;
}

/** Ver el original privado (sin difuminar) de una media, para moderación (ADR 0168). Siempre con motivo. */
export const OriginalAccessRequest = z.object({
  reason: z.string().trim().min(3).max(1000),
  caseId: z.uuid().optional(),
});
export type OriginalAccessRequest = z.infer<typeof OriginalAccessRequest>;
/** Ruta relativa a la API, válida unos segundos; el archivo sale sin metadatos pero sin el difuminado. */
export interface OriginalAccessGrant { path: string; mime: string; expiresAt: string }
/** Filtros del registro de accesos a originales (ADR 0239). */
export const OriginalAccessQuery = z.object({
  mediaId: z.uuid().optional(),
  actorUserId: z.uuid().optional(),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type OriginalAccessQuery = z.infer<typeof OriginalAccessQuery>;
export interface OriginalAccessEntry { id: string; mediaId: string; actorUserId: string; actorHandle?: string | null; reason: string; caseId: string | null; accessedAt: string }
