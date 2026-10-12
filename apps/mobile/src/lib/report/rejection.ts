import type { MessageKey } from "../i18n";
import { uploadErrorText } from "../media/upload-errors";

/**
 * Rechazo definitivo de un reporte (ADR 0333). El servidor responde 422 con `{ outcome: "REJECTED", code, reason }`
 * (estado del país, categoría no válida o solo oficial): no guarda nada y reintentar solo sirve si cambian los datos.
 * La cola guarda un código (`REJECTED:<code>`), nunca un texto: se traduce al mostrarlo, así no llega español a quien
 * usa otro idioma (ADR 0281, 0285). NO AI REQUIRED.
 */
export const REJECTED_PREFIX = "REJECTED:";

/** Código de cola para una respuesta de error del envío, o null si no es un rechazo del reporte. */
export function rejectionReason(status: number | undefined, body: unknown): string | null {
  if (status !== 422 || !body || typeof body !== "object") return null;
  const b = body as { outcome?: unknown; code?: unknown };
  if (b.outcome !== "REJECTED") return null;
  return `${REJECTED_PREFIX}${typeof b.code === "string" && /^[A-Z][A-Z0-9_]*$/.test(b.code) ? b.code : ""}`;
}

/**
 * Texto del motivo por el que un reporte de la cola está detenido: un rechazo se explica por su código, un fallo de
 * subida por el suyo, y un texto ya traducido por la API queda igual.
 */
export function queuedReasonText(reason: string, translate: (key: MessageKey) => string): string {
  if (!reason.startsWith(REJECTED_PREFIX)) return uploadErrorText(reason, translate);
  const code = reason.slice(REJECTED_PREFIX.length);
  const hint = code ? translate(`rejected_${code}` as MessageKey) : undefined;
  return hint ? `${translate("rejected")}. ${hint}` : translate("rejected");
}
