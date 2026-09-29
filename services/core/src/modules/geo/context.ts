import type { AdminAreaRef, ContextualLocation, PlaceGranularity, Sensitivity } from "@dizaster/contracts";

/** Contexto completo resuelto para una celda (antes de aplicar la sensibilidad). */
export interface ResolvedContext {
  country: { code: string; name: string } | null;
  region: AdminAreaRef | null;
  city: { id: string | null; name: string } | null;
  district: AdminAreaRef | null;
  timezone: string | null;
}

/**
 * Detalle máximo que se publica por sensibilidad. El punto público ya viene generalizado;
 * esto evita además que un nombre de distrito pequeño delate dónde ocurrió algo muy sensible.
 */
export const MAX_GRANULARITY: Record<Sensitivity, PlaceGranularity> = {
  NORMAL: "DISTRICT",
  SENSITIVE: "DISTRICT",
  HIGHLY_SENSITIVE: "CITY",
};

const ORDER: PlaceGranularity[] = ["COUNTRY", "REGION", "CITY", "DISTRICT"];

export function toContextualLocation(r: ResolvedContext, sensitivity: Sensitivity): ContextualLocation | null {
  if (!r.country && !r.region) return null;
  const max = ORDER.indexOf(MAX_GRANULARITY[sensitivity]);
  const district = max >= ORDER.indexOf("DISTRICT") ? r.district : null;
  const city = max >= ORDER.indexOf("CITY") ? r.city : null;
  const granularity: PlaceGranularity = district ? "DISTRICT" : city ? "CITY" : r.region ? "REGION" : "COUNTRY";
  return { country: r.country, region: r.region, city, district, label: labelFor(r.country, r.region, city, district), granularity, timezone: r.timezone };
}

/** "Distrito, Ciudad" · "Ciudad, Región" · "Región, País" · "País". Los nombres repetidos se colapsan ("Callao"). */
export function labelFor(
  country: { name: string } | null,
  region: { name: string } | null,
  city: { name: string } | null,
  district: { name: string } | null,
): string {
  const parts = district ? [district.name, city?.name ?? region?.name] : city ? [city.name, region?.name] : [region?.name, country?.name];
  const out: string[] = [];
  for (const p of parts) if (p && !out.some((o) => o.toLocaleLowerCase("es") === p.toLocaleLowerCase("es"))) out.push(p);
  return out.join(", ") || country?.name || "";
}
