import { XMLParser } from "fast-xml-parser";
import type { NormalizedItem } from "../index.js";
import { categoryMap, type FeedAdapter } from "./types.js";

/**
 * Palabras de peligro de una activación → taxonomía de Dizaster, por defecto (el registro puede traer su
 * `categoryMap`, ADR 0122). Se busca como palabra completa, sin mayúsculas, en la categoría del ítem y, si no hay,
 * en el título ("[EMSR812] Peru: Flood in Piura"); gana la primera de la lista. Solo incendios forestales: un
 * incendio industrial no es "fire.wildfire". Lo que no encaja (accidentes industriales, crisis humanitarias...) se
 * ignora: no se inventa categoría.
 */
export const COPERNICUS_CATEGORY_MAP: Readonly<Record<string, string>> = {
  "wildfire": "fire.wildfire", "wild fire": "fire.wildfire", "forest fire": "fire.wildfire", "bushfire": "fire.wildfire",
  "bush fire": "fire.wildfire", "vegetation fire": "fire.wildfire",
  "tsunami": "natural.tsunami",
  "earthquake": "natural.earthquake", "seismic": "natural.earthquake",
  "flood": "natural.flood", "flooding": "natural.flood", "flash flood": "natural.flood", "inundation": "natural.flood",
  "landslide": "natural.landslide", "mass movement": "natural.landslide", "mudslide": "natural.landslide", "debris flow": "natural.landslide",
  "volcano": "natural.volcano", "volcanic": "natural.volcano", "eruption": "natural.volcano",
  "storm": "natural.storm", "cyclone": "natural.storm", "hurricane": "natural.storm", "typhoon": "natural.storm",
  "tornado": "natural.storm", "windstorm": "natural.storm",
  "drought": "natural.drought",
  "cold wave": "natural.cold_wave", "snow": "natural.cold_wave", "frost": "natural.cold_wave",
};

const EMSR = /\bEMSR\d{2,5}\b/i;

/**
 * Copernicus EMS — Rapid Mapping (ADR 0120). GeoRSS de activaciones: cada una es un desastre ya en curso que un
 * servicio de protección civil pidió cartografiar. Identidad estable: el código EMSR. Punto de `georss:point`
 * ("lat lng") o, si solo hay `georss:polygon`, el centro de su caja (con incertidumbre acorde al tamaño).
 * Corrobora de forma externa (nunca OFFICIALLY_CONFIRMED) y llega horas después del suceso: no usa el carril
 * urgente. NO AI REQUIRED.
 */
export const copernicusEmsAdapter: FeedAdapter = {
  adapterType: "copernicus-ems-georss",

  parse(body, config) {
    const hazards = compile(categoryMap(config, COPERNICUS_CATEGORY_MAP));
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", removeNSPrefix: true, parseTagValue: false });
    const doc = parser.parse(body) as { rss?: { channel?: { item?: unknown } | "" } };
    if (doc.rss?.channel === undefined) throw new Error("Copernicus EMS: el documento no es un canal RSS");
    const raw = doc.rss.channel === "" ? undefined : doc.rss.channel.item;
    const list = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Record<string, unknown>[];
    const items: NormalizedItem[] = [];
    for (const it of list) {
      const title = text(it["title"]);
      const code = (text(it["guid"]) + " " + title + " " + text(it["link"])).match(EMSR)?.[0]?.toUpperCase();
      const categories = (Array.isArray(it["category"]) ? it["category"] : [it["category"]]).map(text).join(" ");
      const category = hazard(hazards, categories) ?? hazard(hazards, title);
      const where = location(it);
      if (!code || !category || !where) continue;
      const published = parseDate(it["pubDate"]);
      // Sin ninguna fecha se descarta: "ahora" haría que el ítem cambie en cada lectura (ADR 0133).
      const occurred = parseDate(it["eventTime"]) ?? parseDate(it["eventDate"]) ?? published;
      if (!occurred) continue;
      items.push({
        externalId: code,
        categoryCode: category,
        point: where.point,
        uncertaintyM: where.uncertaintyM,
        occurredAt: occurred.toISOString(),
        publishedAt: (published ?? occurred).toISOString(),
        title: { en: title || code },
        link: /^https:\/\//.test(text(it["link"])) ? text(it["link"]) : null,
        // Una activación de cartografía rápida ya implica un desastre con impacto relevante.
        severity: 4,
        assertion: "OCCURRING",
        raw: { emsr: code, country: country(title), hazard: category },
      });
    }
    return items;
  },

  isUrgent() {
    return false;
  },
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const compile = (map: Readonly<Record<string, string>>): [RegExp, string][] =>
  Object.entries(map).map(([word, code]) => [new RegExp(`\\b${escape(word).replace(/ /g, "\\s+")}\\b`, "i"), code]);

function hazard(hazards: [RegExp, string][], s: string): string | null {
  for (const [re, code] of hazards) if (re.test(s)) return code;
  return null;
}

/** "[EMSR812] Peru: Flood in Piura" → "Peru". */
function country(title: string): string | null {
  const m = title.replace(/^\s*\[[^\]]*\]\s*/, "").match(/^([^:]{2,60}):/);
  return m ? m[1]!.trim() : null;
}

function location(it: Record<string, unknown>): { point: { lat: number; lng: number }; uncertaintyM: number } | null {
  const pair = text(it["point"]).trim().split(/\s+/).map(Number);
  if (pair.length === 2 && valid(pair[0]!, pair[1]!)) return { point: { lat: pair[0]!, lng: pair[1]! }, uncertaintyM: 25_000 };
  // georss:polygon = "lat lng lat lng ..."; se usa el centro de su caja.
  const coords = text(it["polygon"]).trim().split(/\s+/).map(Number);
  if (coords.length < 6 || coords.length % 2 !== 0 || coords.some((n) => !Number.isFinite(n))) return null;
  const lats = coords.filter((_, i) => i % 2 === 0);
  const lngs = coords.filter((_, i) => i % 2 === 1);
  const lat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const lng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
  if (!valid(lat, lng)) return null;
  const spanKm = Math.max(Math.max(...lats) - Math.min(...lats), (Math.max(...lngs) - Math.min(...lngs)) * Math.cos((lat * Math.PI) / 180)) * 111;
  return { point: { lat, lng }, uncertaintyM: Math.min(200_000, Math.max(25_000, Math.round((spanKm * 1000) / 2))) };
}

const valid = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

function text(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "object") return text((v as Record<string, unknown>)["#text"]);
  return String(v);
}

function parseDate(v: unknown): Date | null {
  const s = text(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
