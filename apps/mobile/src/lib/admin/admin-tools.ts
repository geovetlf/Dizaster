/**
 * Herramientas de administración en la app (ADR 0098). NO AI REQUIRED.
 */

/** Tope de presupuesto escrito a mano ("12,5", "$ 40"): USD entre 0 y 1 000 000, o null si no es válido. */
export function parseUsd(text: string): number | null {
  const clean = text.replace(/[$\s]/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const n = Number(clean);
  return n >= 0 && n <= 1_000_000 ? n : null;
}

/**
 * Lista escrita a mano para el ámbito de una institución (ADR 0095): separada por comas o espacios, sin repetidos.
 * Países en mayúsculas ISO de 2 letras; categorías en minúsculas con puntos ("natural.flood"). Lo que no encaja va a
 * `invalid` para mostrarlo, nunca se descarta en silencio.
 */
export function parseScopeList(text: string, kind: "country" | "category"): { values: string[]; invalid: string[] } {
  const items = text.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean).map((s) => (kind === "country" ? s.toUpperCase() : s.toLowerCase()));
  const valid = kind === "country" ? /^[A-Z]{2}$/ : /^[a-z_]+(\.[a-z_]+)*$/;
  const values = [...new Set(items.filter((s) => valid.test(s)))];
  const invalid = [...new Set(items.filter((s) => !valid.test(s)))];
  return { values, invalid };
}

/** Id corto para mostrar en registros de auditoría (los primeros 8 caracteres bastan para distinguir a simple vista). */
export const shortId = (id: string) => id.slice(0, 8);

/** Minutos de retraso de publicación escritos a mano (ADR 0109): entero de 0 a 1440, o null si no es válido. */
export function parseDelayMinutes(text: string): number | null {
  const clean = text.trim();
  if (!/^\d{1,4}$/.test(clean)) return null;
  const n = Number(clean);
  return n <= 1440 ? n : null;
}

/**
 * Referencias internas de un requerimiento de autoridad (ADR 0139): "user:<uuid>", "post:<uuid>"… separadas por comas
 * o espacios. Nunca nombres ni teléfonos: lo que no encaja va a `invalid` para mostrarlo.
 */
export function parseSubjectRefs(text: string): { values: string[]; invalid: string[] } {
  const items = text.split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const valid = /^(user|post|comment|report|event|business):[0-9a-f-]{36}$/;
  return { values: [...new Set(items.filter((s) => valid.test(s)))], invalid: [...new Set(items.filter((s) => !valid.test(s)))] };
}

/** Plazo en días escrito a mano (1 a 365) → fecha ISO; vacío → null (sin plazo); inválido → "invalid". */
export function dueFromDays(text: string, now: Date): string | null | "invalid" {
  const clean = text.trim();
  if (clean === "") return null;
  if (!/^\d{1,3}$/.test(clean)) return "invalid";
  const n = Number(clean);
  return n >= 1 && n <= 365 ? new Date(now.getTime() + n * 86_400_000).toISOString() : "invalid";
}
