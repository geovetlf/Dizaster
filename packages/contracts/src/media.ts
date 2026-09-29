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
  })
  .superRefine((v, ctx) => {
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
  /** Miniatura (máx. 400 px) para listas y mosaicos; null en videos hasta que exista el póster. */
  thumbUrl: string | null;
}
