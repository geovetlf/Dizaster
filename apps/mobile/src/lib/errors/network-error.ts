import type { MessageKey } from "../i18n";

/**
 * Texto de una petición que no obtuvo respuesta (ADR 0292): sin conexión o sin respuesta a tiempo. Nunca el mensaje
 * técnico del sistema ("Network request failed"), que no está traducido. NO AI REQUIRED.
 */
export function networkErrorKey(e: unknown): Extract<MessageKey, "errOffline" | "errTimeout"> {
  return (e as { timedOut?: unknown } | null)?.timedOut === true ? "errTimeout" : "errOffline";
}
