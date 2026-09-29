import type { NormalizedItem } from "../index.js";
import { num, type FeedAdapter } from "./types.js";
import { magnitudeToSeverity } from "./usgs.js";

interface EmscFeature {
  id?: string;
  properties?: {
    unid?: string; time?: string; lastupdate?: string; lat?: number; lon?: number; depth?: number;
    mag?: number | null; magtype?: string; flynn_region?: string; evtype?: string; auth?: string;
  };
  geometry?: { type?: string; coordinates?: [number, number, number?] };
}

/** Tipos de evento EMSC que son sismos: `ke` sismo conocido, `se` sismo sospechado. Explosiones (`kr`, `qb`…) no. */
const EARTHQUAKE_TYPES = new Set(["ke", "se"]);

/**
 * EMSC (Centro Sismológico Euro-Mediterráneo) — servicio FDSN event con `format=json` (ADR 0080).
 * Formato: FeatureCollection; `properties.time` ISO 8601; `coordinates` = [lng, lat, -profundidad_km]; id = `unid`.
 * Fuente EXTERNA (agregador científico, no la agencia oficial de un país): corrobora, no confirma oficialmente.
 * `auth` (la agencia que calculó el sismo, p. ej. IGP) se guarda para mostrarlo y auditar.
 */
export const emscAdapter: FeedAdapter = {
  adapterType: "emsc-fdsn-json",

  parse(body, config) {
    const doc = JSON.parse(body) as { type?: string; features?: EmscFeature[] };
    if (doc.type !== "FeatureCollection" || !Array.isArray(doc.features)) throw new Error("EMSC: formato inesperado");
    const minMag = num(config["minMagnitude"], 3.5);
    const items: NormalizedItem[] = [];
    for (const f of doc.features) {
      const p = f.properties ?? {};
      const id = p.unid ?? f.id;
      const c = f.geometry?.coordinates;
      const lat = typeof p.lat === "number" ? p.lat : c?.[1];
      const lng = typeof p.lon === "number" ? p.lon : c?.[0];
      const time = p.time ? Date.parse(p.time) : Number.NaN;
      if (!id || typeof lat !== "number" || typeof lng !== "number" || Math.abs(lat) > 90 || Math.abs(lng) > 180 || !Number.isFinite(time)) continue;
      if (p.evtype && !EARTHQUAKE_TYPES.has(p.evtype)) continue;
      const mag = typeof p.mag === "number" ? p.mag : null;
      if (mag === null || mag < minMag) continue;
      const updated = p.lastupdate ? Date.parse(p.lastupdate) : Number.NaN;
      const region = p.flynn_region ? titleCase(p.flynn_region) : null;
      items.push({
        externalId: id,
        categoryCode: "natural.earthquake",
        point: { lat, lng },
        uncertaintyM: 10_000,
        occurredAt: new Date(time).toISOString(),
        publishedAt: new Date(Number.isFinite(updated) ? updated : time).toISOString(),
        link: `https://www.seismicportal.eu/eventdetails.html?unid=${encodeURIComponent(id)}`,
        title: { en: `M ${mag.toFixed(1)} earthquake${region ? ` · ${region}` : ""}`, es: `Sismo M${mag.toFixed(1)}${region ? ` · ${region}` : ""}` },
        severity: magnitudeToSeverity(mag),
        assertion: "OCCURRING",
        raw: { mag, magType: p.magtype ?? null, depthKm: typeof p.depth === "number" ? p.depth : null, region: p.flynn_region ?? null, auth: p.auth ?? null },
      });
    }
    return items;
  },

  isUrgent(item, config) {
    return Number(item.raw["mag"] ?? 0) >= num(config["urgentMinMagnitude"], 4.5);
  },
};

/** "NEAR COAST OF CENTRAL PERU" → "Near Coast Of Central Peru" (EMSC publica las regiones Flinn-Engdahl en mayúsculas). */
function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}
