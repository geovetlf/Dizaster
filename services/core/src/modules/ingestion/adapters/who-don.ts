import type { NormalizedItem } from "../index.js";
import type { FeedAdapter } from "./types.js";
import { countryCodeForName } from "./country-names.js";

interface DonItem { Id?: string; Title?: string; PublicationDate?: string; PublicationDateAndTime?: string; UrlName?: string; ItemDefaultUrl?: string }

/**
 * OMS — Disease Outbreak News, API JSON (OData) (ADR 0092). Carril NORMAL. Los brotes son `health.outbreak`, que
 * solo aceptan fuentes oficiales o externas (D-09). El título trae el país ("Cholera – Haiti"): se convierte en un
 * código ISO del país y el servidor lo ubica con su índice (geocódigo ISO3166-1). Sin país reconocible, sin mapa.
 */
export const whoDonAdapter: FeedAdapter = {
  adapterType: "who-don-json",

  parse(body) {
    const doc = JSON.parse(body) as { value?: DonItem[] };
    if (!Array.isArray(doc.value)) throw new Error("OMS DON: formato inesperado");
    const items: NormalizedItem[] = [];
    for (const it of doc.value) {
      const title = it.Title?.trim();
      const published = parseDate(it.PublicationDateAndTime) ?? parseDate(it.PublicationDate);
      if (!it.Id || !title || !published) continue;
      // "Enfermedad – País" (guion largo, medio o normal); varios países separados por comas o "and".
      const place = title.split(/\s+[–—-]\s+/).slice(1).join(" - ");
      const codes = place.split(/,|\band\b|\by\b/).map((s) => countryCodeForName(s)).filter((c): c is string => !!c);
      const slug = it.UrlName ?? it.ItemDefaultUrl?.replace(/^\/+/, "");
      items.push({
        externalId: `don-${it.Id}`,
        categoryCode: "health.outbreak",
        point: null,
        uncertaintyM: 0,
        occurredAt: published.toISOString(),
        publishedAt: published.toISOString(),
        title: { en: title.slice(0, 200) },
        link: slug ? `https://www.who.int/emergencies/disease-outbreak-news/item/${encodeURIComponent(slug)}` : null,
        severity: 3,
        assertion: "OCCURRING",
        ...(codes.length ? { geocodes: [...new Set(codes)].map((value) => ({ scheme: "ISO3166-1", value })) } : {}),
        raw: { place: place || null },
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
