import type { LocalMedia } from "../media/local-media";

/**
 * Borrador de reporte en el teléfono (§5.4 `ReportDraft`, ADR 0191). Guarda lo que la persona escribió y adjuntó,
 * nunca la ubicación: al retomarlo se vuelve a pedir el GPS (la presencia es de ahora, no de cuando se empezó).
 * NO AI REQUIRED.
 */
export interface ReportDraft {
  v: 1;
  categoryCode: string;
  text: string;
  pseudonymous: boolean;
  media: LocalMedia[];
  targetEventId: string | null;
  savedAt: number;
  /** Cámara abierta cuando se guardó: si Android mató la app mientras tanto, la foto se recupera al volver. */
  pendingCapture?: { source: "camera" | "library"; kind: "IMAGE" | "VIDEO_RECORDED" } | null;
}

/** Un borrador viejo ya no describe lo que pasa: se descarta (y sus fotos) a las 24 h. */
export const DRAFT_MAX_AGE_MS = 24 * 3600_000;

export const draftIsFresh = (d: ReportDraft | null, now: number): d is ReportDraft => !!d && d.v === 1 && now - d.savedAt <= DRAFT_MAX_AGE_MS;

/** Solo vale la pena ofrecer retomar algo con contenido o con una captura en curso. */
export const draftWorthKeeping = (d: Pick<ReportDraft, "text" | "media" | "pendingCapture">) =>
  d.text.trim().length > 0 || d.media.length > 0 || !!d.pendingCapture;

/** Una copia local sin dueño: ni en la cola ni en el borrador, y con más de `minAgeMs` (no se toca una captura en curso). */
export const ORPHAN_MIN_AGE_MS = 3600_000;

export function orphanMedia(files: { uri: string; modifiedAt: number | null }[], referenced: Set<string>, now: number, minAgeMs = ORPHAN_MIN_AGE_MS): string[] {
  return files.filter((f) => !referenced.has(f.uri) && f.modifiedAt !== null && now - f.modifiedAt > minAgeMs).map((f) => f.uri);
}

/** Uris que siguen en uso por una lista de medios (incluidos los pósters). */
export function referencedUris(media: Pick<LocalMedia, "localUri" | "poster">[]): string[] {
  return media.flatMap((m) => [m.localUri, ...(m.poster?.localUri ? [m.poster.localUri] : [])]);
}
