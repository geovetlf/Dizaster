/**
 * Qué país usar cuando hace falta uno (ADR 0085). NO AI REQUIRED.
 * Orden: ubicación actual (calculada en el teléfono) → país preferido del perfil → región de los ajustes del sistema.
 */
export type CountrySource = "location" | "profile" | "settings";

export function chooseCountry(located: string | null, preferred: string | null, region: string | null): { country: string | null; source: CountrySource | null } {
  if (located) return { country: located, source: "location" };
  if (preferred) return { country: preferred, source: "profile" };
  if (region) return { country: region, source: "settings" };
  return { country: null, source: null };
}

export interface CountryOption { code: string; name: string }

/** Filtra por código exacto o por nombre (sin tildes ni mayúsculas); las sugeridas van primero y sin repetir. */
export function filterCountries(all: readonly CountryOption[], query: string, suggested: readonly (string | null)[] = [], limit = 8): CountryOption[] {
  const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const q = fold(query.trim());
  const byCode = new Map(all.map((c) => [c.code, c]));
  const first = [...new Set(suggested.filter((c): c is string => !!c && byCode.has(c)))].map((c) => byCode.get(c)!);
  const rest = q
    ? all.filter((c) => c.code.toLowerCase() === q || fold(c.name).split(/[\s,()-]+/).some((w) => w.startsWith(q)) || fold(c.name).startsWith(q))
    : [];
  const out = q ? [...first.filter((c) => rest.includes(c)), ...rest] : first;
  return [...new Map(out.map((c) => [c.code, c])).values()].slice(0, limit);
}
