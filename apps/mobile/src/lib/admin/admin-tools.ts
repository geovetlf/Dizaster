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
