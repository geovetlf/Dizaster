import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FEED_ADAPTERS } from "../src/modules/ingestion/adapters/index.js";
import type { NormalizedItem } from "../src/modules/ingestion/index.js";
import { createTestContext, type TestContext } from "./helpers.js";

// ADR 0242: un punto imposible se salta (adaptador) o queda en ERROR (ingesta); nunca tumba la corrida.
describe("coordenadas fuera de rango en las fuentes", () => {
  it("USGS salta el sismo con latitud imposible y conserva el resto", () => {
    const feature = (id: string, lat: number) => ({ type: "Feature", id, properties: { mag: 5, time: Date.now(), type: "earthquake" }, geometry: { type: "Point", coordinates: [-77, lat, 10] } });
    const body = JSON.stringify({ type: "FeatureCollection", features: [feature("bad", 912), feature("good", -12)] });
    expect(FEED_ADAPTERS.get("usgs-geojson")!.parse(body, {}).map((i) => i.externalId)).toEqual(["good"]);
  });

  it("GDACS salta el ítem con longitud imposible", () => {
    const item = (id: number, long: number) => `<item><eventtype>EQ</eventtype><eventid>${id}</eventid><alertlevel>Red</alertlevel><pubDate>Tue, 29 Sep 2026 10:00:00 GMT</pubDate><Point><lat>-12</lat><long>${long}</long></Point></item>`;
    const body = `<rss><channel>${item(1, 777)}${item(2, -77)}</channel></rss>`;
    expect(FEED_ADAPTERS.get("gdacs-rss")!.parse(body, {}).map((i) => i.externalId)).toEqual(["EQ-2"]);
  });

  describe("en la ingesta", () => {
    let t: TestContext;
    beforeAll(async () => { t = await createTestContext(); await t.c.ingestion.setSourceStatus("usgs-earthquakes", "ACTIVE"); });
    afterAll(async () => { await t.close(); });
    it("un punto imposible es un error del ítem (VALIDATION), no de infraestructura", async () => {
      const now = new Date().toISOString();
      const item = { externalId: "x-1", categoryCode: "natural.earthquake", point: { lat: 95, lng: 0 }, uncertaintyM: 1000, occurredAt: now, publishedAt: now, title: { es: "x" }, severity: 3, assertion: "OCCURRING", raw: {} } as NormalizedItem;
      await expect(t.c.ingestion.ingest("usgs-earthquakes", item, "URGENT")).rejects.toMatchObject({ code: "VALIDATION" });
    });
  });
});
