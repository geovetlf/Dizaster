import { XMLParser } from "fast-xml-parser";
import type { NormalizedItem } from "../index.js";
import type { FeedAdapter } from "./types.js";

/** Tipos de evento GDACS → taxonomía de Dizaster. Tipos desconocidos se ignoran (no se inventa categoría). */
const CATEGORY_BY_TYPE: Record<string, string> = {
  EQ: "natural.earthquake",
  TC: "natural.storm",
  FL: "natural.flood",
  VO: "natural.volcano",
  DR: "natural.drought",
  WF: "fire.wildfire",
  TS: "natural.tsunami",
};

const SEVERITY_BY_ALERT: Record<string, number> = { green: 2, orange: 4, red: 5 };

/**
 * GDACS (ONU/UE) — RSS con extensiones gdacs:* y geo:Point.
 * Identidad estable: tipo + eventid + episodeid (cada episodio es una actualización del mismo evento).
 */
export const gdacsAdapter: FeedAdapter = {
  adapterType: "gdacs-rss",

  parse(body) {
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", removeNSPrefix: true, parseTagValue: true });
    const doc = parser.parse(body) as { rss?: { channel?: { item?: unknown } } };
    const raw = doc.rss?.channel?.item;
    const list = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Array<Record<string, unknown>>;
    const items: NormalizedItem[] = [];
    for (const it of list) {
      const type = String(it["eventtype"] ?? "").toUpperCase();
      const category = CATEGORY_BY_TYPE[type];
      const eventId = it["eventid"];
      const point = it["Point"] as { lat?: number; long?: number } | undefined;
      if (!category || eventId === undefined || typeof point?.lat !== "number" || typeof point?.long !== "number") continue;
      const alert = String(it["alertlevel"] ?? "").toLowerCase();
      const from = parseDate(it["fromdate"]) ?? parseDate(it["pubDate"]) ?? new Date();
      const published = parseDate(it["pubDate"]) ?? from;
      items.push({
        externalId: `${type}-${eventId}`,
        categoryCode: category,
        point: { lat: point.lat, lng: point.long },
        uncertaintyM: type === "TC" || type === "DR" ? 100_000 : 25_000,
        occurredAt: from.toISOString(),
        publishedAt: published.toISOString(),
        title: { en: String(it["title"] ?? type) },
        link: typeof it["link"] === "string" ? it["link"] : null,
        severity: SEVERITY_BY_ALERT[alert] ?? 2,
        assertion: "OCCURRING",
        raw: {
          alertLevel: alert || null,
          episodeId: it["episodeid"] ?? null,
          country: it["country"] ?? null,
          link: it["link"] ?? null,
          isCurrent: String(it["iscurrent"] ?? "") === "true",
        },
      });
    }
    return items;
  },

  isUrgent(item) {
    return item.raw["alertLevel"] === "orange" || item.raw["alertLevel"] === "red";
  },
};

function parseDate(v: unknown): Date | null {
  if (v === undefined || v === null || v === "") return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}
