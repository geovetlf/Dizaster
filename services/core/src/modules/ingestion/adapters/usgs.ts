import type { NormalizedItem } from "../index.js";
import { num, validLatLng, type FeedAdapter } from "./types.js";

interface UsgsFeature {
  id?: string;
  properties?: {
    mag?: number | null; place?: string | null; time?: number; updated?: number; url?: string; status?: string;
    tsunami?: number; type?: string; title?: string; alert?: string | null;
  };
  geometry?: { type?: string; coordinates?: [number, number, number?] };
}

/** Magnitud → severidad 1–5 de Dizaster (heurística inicial, calibrable por país). */
export function magnitudeToSeverity(mag: number): number {
  if (mag >= 7) return 5;
  if (mag >= 6) return 4;
  if (mag >= 5) return 3;
  if (mag >= 4) return 2;
  return 1;
}

/**
 * USGS Earthquake Hazards — feeds GeoJSON "summary" (dominio público).
 * Formato: FeatureCollection; properties.time en ms; coordinates = [lng, lat, profundidad_km].
 * Solo se ingieren sismos ("type": "earthquake"); explosiones y canteras se descartan.
 */
export const usgsAdapter: FeedAdapter = {
  adapterType: "usgs-geojson",

  parse(body, config) {
    const doc = JSON.parse(body) as { type?: string; features?: UsgsFeature[] };
    if (doc.type !== "FeatureCollection" || !Array.isArray(doc.features)) throw new Error("USGS: formato inesperado");
    const minMag = num(config["minMagnitude"], 2.5);
    const items: NormalizedItem[] = [];
    for (const f of doc.features) {
      const p = f.properties ?? {};
      const c = f.geometry?.coordinates;
      if (!f.id || !c || typeof c[0] !== "number" || typeof c[1] !== "number" || !validLatLng(c[1], c[0]) || typeof p.time !== "number" || !Number.isFinite(p.time)) continue;
      if (p.type && p.type !== "earthquake") continue;
      const mag = typeof p.mag === "number" ? p.mag : null;
      if (mag === null || mag < minMag) continue;
      const retracted = p.status === "deleted";
      items.push({
        externalId: f.id,
        categoryCode: "natural.earthquake",
        point: { lat: c[1], lng: c[0] },
        uncertaintyM: 10_000,
        occurredAt: new Date(p.time).toISOString(),
        publishedAt: new Date(p.updated ?? p.time).toISOString(),
        link: p.url ?? null,
        title: { en: p.title ?? `M ${mag} earthquake`, es: `Sismo M${mag.toFixed(1)}${p.place ? ` · ${p.place}` : ""}` },
        severity: magnitudeToSeverity(mag),
        assertion: retracted ? "NOT_OCCURRING" : "OCCURRING",
        raw: { mag, depthKm: c[2] ?? null, place: p.place ?? null, url: p.url ?? null, status: p.status ?? null, tsunami: p.tsunami ?? 0, alert: p.alert ?? null },
      });
    }
    return items;
  },

  isUrgent(item, config) {
    const mag = Number(item.raw["mag"] ?? 0);
    return mag >= num(config["urgentMinMagnitude"], 4.5) || Number(item.raw["tsunami"] ?? 0) === 1;
  },
};
