import { detectLanguage } from "@dizaster/contracts";
import { XMLParser } from "fast-xml-parser";
import type { NormalizedItem } from "../index.js";
import type { FeedAdapter } from "./types.js";

interface RssConfig { eventMap?: { match: string; category: string }[]; summaryMaxChars?: number }

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/**
 * RSS/Atom de medios con GeoRSS (ADR 0092). Carril NORMAL. Por derechos de autor solo se guarda titular, enlace y un
 * resumen corto (por defecto 200 caracteres, sin HTML); nunca el artículo. La categoría sale de palabras clave de la
 * configuración de cada fuente (como CAP); sin coincidencia o sin coordenadas (`georss:point`, `geo:lat/long`), la
 * noticia no se ubica ni crea eventos.
 */
export const rssNewsAdapter: FeedAdapter = {
  adapterType: "rss-news",

  parse(body, rawConfig) {
    const config = rawConfig as RssConfig;
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", removeNSPrefix: true, parseTagValue: false });
    const doc = parser.parse(body) as { rss?: { channel?: { item?: unknown } }; feed?: { entry?: unknown } };
    const raw = doc.rss?.channel?.item ?? doc.feed?.entry;
    const list = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Record<string, unknown>[];
    const max = Math.min(Math.max(config.summaryMaxChars ?? 200, 0), 300);
    const items: NormalizedItem[] = [];
    for (const it of list) {
      const title = text(it["title"]);
      const link = linkOf(it["link"]);
      const id = text(it["guid"]) ?? text(it["id"]) ?? link;
      const published = parseDate(text(it["pubDate"]) ?? text(it["published"]) ?? text(it["updated"]));
      if (!title || !id || !published) continue;
      const summary = stripHtml(text(it["description"]) ?? text(it["summary"]) ?? "");
      const hay = fold(`${title} ${summary}`);
      const category = config.eventMap?.find((m) => hay.includes(fold(m.match)))?.category;
      if (!category) continue;
      items.push({
        externalId: `news-${id}`.slice(0, 300),
        categoryCode: category,
        point: pointOf(it),
        uncertaintyM: 10_000,
        occurredAt: published.toISOString(),
        publishedAt: published.toISOString(),
        title: { [detectLanguage(`${title}. ${summary}`) ?? "und"]: title.slice(0, 200) },
        link: link?.startsWith("https://") ? link : null,
        severity: 2,
        assertion: "OCCURRING",
        raw: { summary: summary.slice(0, max) || null },
      });
    }
    return items;
  },

  isUrgent: () => false,
};

function text(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number") return String(v);
  if (v && typeof v === "object" && "#text" in v) return text((v as { "#text": unknown })["#text"]);
  return null;
}

function linkOf(v: unknown): string | null {
  if (Array.isArray(v)) return linkOf(v.find((l) => (l as Record<string, unknown>)?.["@rel"] !== "self") ?? v[0]);
  if (v && typeof v === "object" && "@href" in v) return text((v as Record<string, unknown>)["@href"]);
  return text(v);
}

function pointOf(it: Record<string, unknown>): { lat: number; lng: number } | null {
  const pt = text(it["point"]);
  const [lat, lng] = pt ? pt.split(/\s+/).map(Number) : [Number(text(it["lat"])), Number(text(it["long"]))];
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat!) <= 90 && Math.abs(lng!) <= 180 && !(lat === 0 && lng === 0)
    ? { lat: lat!, lng: lng! } : null;
}

const stripHtml = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();

function parseDate(v: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
