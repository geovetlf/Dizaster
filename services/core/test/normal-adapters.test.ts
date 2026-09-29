import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { countryCodeForName } from "../src/modules/ingestion/adapters/country-names.js";
import { FEED_ADAPTERS } from "../src/modules/ingestion/index.js";
import { createTestContext, type TestContext } from "./helpers.js";

// Adapters del carril NORMAL: ReliefWeb, OMS DON y RSS de noticias (ADR 0092). NO AI REQUIRED.
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("ReliefWeb", () => {
  const a = FEED_ADAPTERS.get("reliefweb-disasters-json")!;
  it("solo desastres en curso de tipos conocidos, con el punto del país y gran incertidumbre", () => {
    const items = a.parse(fixture("reliefweb-disasters.json"), {});
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      externalId: "rw-52001", categoryCode: "natural.flood", point: { lat: -9.19, lng: -75.0152 }, uncertaintyM: 250_000,
      link: "https://reliefweb.int/disaster/fl-2026-000042-per", raw: { glide: "FL-2026-000042-PER", precision: "COUNTRY" },
    });
    expect(a.isUrgent(items[0]!, {})).toBe(false);
    expect(() => a.parse("{}", {})).toThrow(/formato/);
  });
});

describe("OMS Disease Outbreak News", () => {
  const a = FEED_ADAPTERS.get("who-don-json")!;
  it("brote con el país del título como geocódigo; varios países; sin país reconocible, sin geocódigo", () => {
    const items = a.parse(fixture("who-don.json"), {});
    expect(items.map((i) => i.externalId)).toEqual(["don-a1b2c3", "don-d4e5f6", "don-g7h8i9"]);
    expect(items[0]).toMatchObject({ categoryCode: "health.outbreak", point: null, geocodes: [{ scheme: "ISO3166-1", value: "HT" }] });
    expect(items[0]!.link).toBe("https://www.who.int/emergencies/disease-outbreak-news/item/2026-DON600");
    expect(items[1]!.geocodes).toEqual([{ scheme: "ISO3166-1", value: "PE" }, { scheme: "ISO3166-1", value: "EC" }]);
    expect(items[2]!.geocodes).toBeUndefined();
  });
  it("nombres de país en varios idiomas", () => {
    expect(countryCodeForName("Perú")).toBe("PE");
    expect(countryCodeForName("Democratic Republic of the Congo")).toBe("CD");
    expect(countryCodeForName("Brasil")).toBe("BR");
    expect(countryCodeForName("Multi-country")).toBeNull();
  });
});

describe("RSS de noticias", () => {
  const a = FEED_ADAPTERS.get("rss-news")!;
  const CONFIG = { eventMap: [{ match: "incendio forestal", category: "fire.wildfire" }, { match: "inundacion", category: "natural.flood" }] };
  it("solo titular, enlace https y resumen corto sin HTML; categoría por palabras clave; GeoRSS", () => {
    const items = a.parse(fixture("news.rss"), CONFIG);
    expect(items.map((i) => i.externalId)).toEqual(["news-noticia-1", "news-noticia-3"]);
    const [fire, flood] = items;
    expect(fire).toMatchObject({ categoryCode: "fire.wildfire", point: { lat: -13.53, lng: -71.97 }, title: { es: "Incendio forestal avanza en la sierra de Cusco" } });
    expect(fire!.link).toBe("https://noticias.example/incendio-cusco");
    expect(String(fire!.raw["summary"]).length).toBeLessThanOrEqual(200);
    expect(String(fire!.raw["summary"])).not.toContain("<p>");
    expect(flood).toMatchObject({ point: null, link: null });
  });
});

describe("ubicación por país (ISO 3166-1)", () => {
  let t: TestContext;
  beforeAll(async () => { t = await createTestContext(); });
  afterAll(async () => { await t.close(); });

  it("un brote en Haití queda dentro de Haití, con radio amplio y sin área", async () => {
    const r = await t.c.geo.locateGeocodes(t.c.db, [{ scheme: "ISO3166-1", value: "HT" }]);
    expect(r).not.toBeNull();
    expect(t.c.geo.countryOf(r!.point)).toBe("HT");
    expect(r!.radiusM).toBeGreaterThan(50_000);
    expect(r!.area).toBeNull();
    // Chile es largo y cóncavo: el punto igual cae dentro.
    expect(t.c.geo.countryOf(t.c.geo.countryPoint("CL")!.point)).toBe("CL");
    expect(await t.c.geo.locateGeocodes(t.c.db, [{ scheme: "ISO3166-1", value: "ZZ" }])).toBeNull();
  });

  it("las fuentes nuevas quedan registradas como PLANNED (no ingieren hasta revisar términos)", async () => {
    const { rows } = await t.c.db.query<{ key: string; status: string }>(`SELECT key, status FROM ingestion.sources WHERE key IN ('reliefweb-disasters','who-don') ORDER BY key`);
    expect(rows).toEqual([{ key: "reliefweb-disasters", status: "PLANNED" }, { key: "who-don", status: "PLANNED" }]);
  });
});
