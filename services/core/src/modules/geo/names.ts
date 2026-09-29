/** Partículas que van en minúscula dentro de un topónimo en español ("San Juan de Lurigancho"). */
const PARTICLES_ES = new Set(["de", "del", "la", "las", "los", "el", "y", "e", "en", "a"]);

/** "SAN JUAN DE LURIGANCHO" → "San Juan de Lurigancho". Las fuentes oficiales suelen venir en mayúsculas. */
export function titleCaseEs(raw: string): string {
  const words = raw.trim().toLocaleLowerCase("es").split(/\s+/);
  return words
    .map((w, i) => (i > 0 && PARTICLES_ES.has(w) ? w : w.replace(/(^|[-'(])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toLocaleUpperCase("es"))))
    .join(" ");
}

/** Corrige palabras que la fuente trae sin tildes ("Jesus Maria" → "Jesús María"), según datos por país. */
export function applyWordFixes(name: string, fixes: Record<string, string> | undefined): string {
  if (!fixes) return name;
  return name.replace(/\p{L}+/gu, (w) => fixes[w] ?? w);
}

/** Clave de búsqueda: minúsculas, sin tildes ni signos. "Jesús María" → "jesus maria". */
export function searchKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
