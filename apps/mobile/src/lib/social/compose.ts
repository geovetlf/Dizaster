import { POST_TEXT_MAX } from "@dizaster/contracts";
import type { LocalMedia } from "../media/local-media";

/** Qué impide publicar (clave de i18n) o null si se puede. Mismas reglas que el servidor. */
export function composeProblem(text: string, media: Pick<LocalMedia, "kind">[]): "composeEmpty" | "composeTooLong" | "composeOneVideo" | null {
  const n = text.trim().length;
  if (n === 0) return "composeEmpty";
  if (n > POST_TEXT_MAX) return "composeTooLong";
  if (media.filter((m) => m.kind === "VIDEO_RECORDED").length > 1) return "composeOneVideo";
  return null;
}
