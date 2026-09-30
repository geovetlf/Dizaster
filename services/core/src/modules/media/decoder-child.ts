import sharp from "sharp";
import { renderImage } from "./images.js";
import { MalformedMediaError, sanitize, videoInfo, type MediaFamily } from "./sanitize.js";

/**
 * Proceso hijo de decodificación (ADR 0194). Sin acceso a la base, sin secretos (el padre no le pasa el entorno)
 * y sin red: solo recibe bytes y devuelve bytes. Un archivo a la vez, sin caché de libvips.
 */
sharp.concurrency(1);
sharp.cache(false);

type Msg =
  | { id: number; op: "sanitize"; family: MediaFamily; data: Uint8Array }
  | { id: number; op: "videoInfo"; data: Uint8Array }
  | { id: number; op: "renderImage"; data: Uint8Array; redactions: { x: number; y: number; w: number; h: number }[] };

process.on("message", (m: Msg) => {
  void (async () => {
    try {
      const value = m.op === "sanitize" ? sanitize(m.family, m.data) : m.op === "videoInfo" ? videoInfo(m.data) : await renderImage(m.data, m.redactions);
      process.send?.({ id: m.id, ok: true, value });
    } catch (e) {
      process.send?.({ id: m.id, ok: false, malformed: e instanceof MalformedMediaError, message: (e as Error).message });
    }
  })();
});
// Si el padre muere, el hijo no se queda huérfano.
process.on("disconnect", () => process.exit(0));
