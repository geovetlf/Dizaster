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
