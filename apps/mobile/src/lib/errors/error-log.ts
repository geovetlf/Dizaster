/**
 * Registro local de errores de la app (ADR 0161). Solo en el teléfono: no se envía a ningún servicio (el proveedor
 * de errores sigue BLOQUEADO a la espera del DSN). Se redacta antes de guardar: nada de tokens, correos ni
 * coordenadas. NO AI REQUIRED.
 */
/** `requestId`: id de la petición fallida (ADR 0172), para buscarla en los registros del servidor. */
export interface ErrorEntry { at: string; message: string; where: string | null; stack: string | null; requestId?: string }

const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

export const MAX_ERROR_ENTRIES = 20;
const MAX_MESSAGE = 300;
const MAX_STACK_LINES = 6;

/** Quita lo que podría identificar a la persona o su ubicación. */
export function redact(text: string): string {
  return text
    .replace(/Bearer\s+[\w.~+/=-]+/gi, "Bearer ***")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "***@***")
    .replace(/-?\d{1,3}\.\d{3,}/g, "#.###")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<id>");
}

export function toEntry(error: unknown, where: string | null, now: Date): ErrorEntry {
  const e = error instanceof Error ? error : new Error(String(error));
  const stack = e.stack ? redact(e.stack.split("\n").slice(1, 1 + MAX_STACK_LINES).map((l) => l.trim()).join("\n")) : null;
  const requestId = (error as { requestId?: unknown } | null)?.requestId;
  return {
    at: now.toISOString(), message: redact(`${e.name}: ${e.message}`).slice(0, MAX_MESSAGE), where: where ? redact(where) : null, stack: stack || null,
    ...(typeof requestId === "string" && REQUEST_ID.test(requestId) ? { requestId } : {}),
  };
}

/** Lo más reciente primero, sin pasar del máximo. */
export function appendEntry(log: readonly ErrorEntry[], entry: ErrorEntry, max = MAX_ERROR_ENTRIES): ErrorEntry[] {
  return [entry, ...log].slice(0, max);
}

export function parseLog(raw: unknown): ErrorEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is ErrorEntry => !!x && typeof x === "object" && typeof (x as ErrorEntry).at === "string" && typeof (x as ErrorEntry).message === "string")
    .slice(0, MAX_ERROR_ENTRIES);
}
