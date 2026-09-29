import type { NormalizedItem } from "../index.js";
import type { FeedAdapter } from "./types.js";

/** Tipos de desastre de ReliefWeb (GLIDE) → taxonomía de Dizaster. Los demás se ignoran. */
const CATEGORY_BY_TYPE: Record<string, string> = {
  EQ: "natural.earthquake", TS: "natural.tsunami", FL: "natural.flood", FF: "natural.flood", SS: "natural.flood",
  LS: "natural.landslide", MS: "natural.landslide", TC: "natural.storm", ST: "natural.storm", EC: "natural.storm",
  VO: "natural.volcano", DR: "natural.drought", CW: "natural.cold_wave", WF: "fire.wildfire", EP: "health.outbreak",
};

interface RwDisaster {
  id?: number | string;
  fields?: {
    name?: string; status?: string; url?: string; glide?: string;
    date?: { created?: string; event?: string; changed?: string };
    primary_type?: { code?: string };
    type?: { code?: string }[];
    primary_country?: { iso3?: string; name?: string; location?: { lat?: number; lon?: number } };
    country?: { iso3?: string; name?: string; primary?: boolean; location?: { lat?: number; lon?: number } }[];
  };
}

/**
 * ReliefWeb (OCHA) — API v2 `/disasters` en JSON (ADR 0092). Carril NORMAL. Fuente EXTERNA humanitaria: corrobora,
 * no confirma. Solo trae el país: el punto es la ubicación del país principal y la incertidumbre es grande, así el
 * mapa no aparenta más precisión de la que hay. Guarda nombre, enlace y GLIDE; nunca el texto de los informes.
 */
export const reliefwebAdapter: FeedAdapter = {
  adapterType: "reliefweb-disasters-json",

  parse(body) {
    const doc = JSON.parse(body) as { data?: RwDisaster[] };
    if (!Array.isArray(doc.data)) throw new Error("ReliefWeb: formato inesperado");
    const items: NormalizedItem[] = [];
    for (const d of doc.data) {
      const f = d.fields ?? {};
      const type = (f.primary_type?.code ?? f.type?.[0]?.code ?? "").toUpperCase();
      const category = CATEGORY_BY_TYPE[type];
      const country = f.primary_country ?? f.country?.find((c) => c.primary) ?? f.country?.[0];
      const lat = country?.location?.lat;
      const lng = country?.location?.lon;
      if (!category || d.id === undefined || typeof lat !== "number" || typeof lng !== "number") continue;
      // "past" = el desastre terminó: no crea eventos nuevos (el registro sigue para auditoría).
      if (f.status === "past") continue;
      const occurred = parseDate(f.date?.event) ?? parseDate(f.date?.created);
      if (!occurred) continue;
      items.push({
        externalId: `rw-${d.id}`,
        categoryCode: category,
        point: { lat, lng },
        uncertaintyM: 250_000,
        occurredAt: occurred.toISOString(),
        publishedAt: (parseDate(f.date?.changed) ?? parseDate(f.date?.created) ?? occurred).toISOString(),
        title: f.name ? { en: f.name.slice(0, 200) } : null,
        link: typeof f.url === "string" && f.url.startsWith("https://") ? f.url : null,
        severity: 3,
        assertion: "OCCURRING",
        raw: { glide: f.glide ?? null, status: f.status ?? null, type, countryIso3: country?.iso3 ?? null, precision: "COUNTRY" },
      });
    }
    return items;
  },

  isUrgent: () => false,
};

function parseDate(v: unknown): Date | null {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
