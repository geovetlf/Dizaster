import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { MEDIA_UPLOAD_LIMITS, type CreateUploadRequest, type UploadableMediaKind } from "@dizaster/contracts";

/**
 * Foto o video preparado en el dispositivo, listo para subir. Lógica común a Android e iOS: solo la captura
 * (capture.ts) toca APIs nativas.
 */
export interface LocalMedia {
  /** Copia en el directorio de la app (no en la caché del sistema, que puede vaciarse antes de enviar). */
  localUri: string;
  kind: UploadableMediaKind;
  mime: string;
  sizeBytes: number;
  sha256: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  capturedInApp: boolean;
  capturedAt: string;
}

/** Parámetros de compresión en el dispositivo (cost-first: menos datos móviles y menos almacenamiento). */
export const IMAGE_MAX_EDGE_PX = 1920;
export const IMAGE_JPEG_QUALITY = 0.7;
export const VIDEO_MAX_SECONDS = MEDIA_UPLOAD_LIMITS.VIDEO_RECORDED.maxDurationMs / 1000;

/** Redimensiona manteniendo proporción para que el lado mayor no pase del máximo. */
export function fitWithin(width: number, height: number, maxEdge = IMAGE_MAX_EDGE_PX): { width: number; height: number } | null {
  const edge = Math.max(width, height);
  if (edge <= maxEdge) return null;
  const k = maxEdge / edge;
  return { width: Math.round(width * k), height: Math.round(height * k) };
}

/** Android graba MP4; iOS graba MOV (QuickTime). Ambos son el mismo contenedor ISO BMFF. */
export function videoMime(uri: string, reported?: string | null): "video/mp4" | "video/quicktime" {
  if (reported === "video/quicktime" || /\.mov$/i.test(uri)) return "video/quicktime";
  return "video/mp4";
}

/** SHA-256 incremental por bloques: no carga un video entero en memoria. */
export async function sha256OfChunks(chunks: AsyncIterable<Uint8Array>): Promise<{ hex: string; size: number }> {
  const h = sha256.create();
  let size = 0;
  for await (const c of chunks) {
    h.update(c);
    size += c.length;
  }
  return { hex: bytesToHex(h.digest()), size };
}

/** Comprueba en el dispositivo los mismos límites que aplica el servidor, para avisar antes de gastar datos. */
export function checkLimits(m: Pick<LocalMedia, "kind" | "mime" | "sizeBytes" | "durationMs">): string | null {
  const limits = MEDIA_UPLOAD_LIMITS[m.kind];
  if (!(limits.mimes as readonly string[]).includes(m.mime)) return "unsupportedType";
  if (m.sizeBytes > limits.maxBytes) return "tooLarge";
  if (limits.maxDurationMs !== null && (m.durationMs ?? Infinity) > limits.maxDurationMs) return "tooLong";
  return null;
}

export function toUploadRequest(m: LocalMedia): CreateUploadRequest {
  return {
    kind: m.kind,
    mime: m.mime,
    sizeBytes: m.sizeBytes,
    sha256: m.sha256,
    ...(m.width ? { width: m.width } : {}),
    ...(m.height ? { height: m.height } : {}),
    ...(m.durationMs ? { durationMs: Math.round(m.durationMs) } : {}),
    capturedAt: m.capturedAt,
    capturedInApp: m.capturedInApp,
  };
}
