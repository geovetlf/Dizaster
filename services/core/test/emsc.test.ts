import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FEED_ADAPTERS } from "../src/modules/ingestion/index.js";
import { createTestContext, type TestContext } from "./helpers.js";

// Adaptador EMSC (ADR 0080). NO AI REQUIRED. La fuente queda PLANNED hasta revisar sus términos.
const emsc = FEED_ADAPTERS.get("emsc-fdsn-json")!;
const body = readFileSync(new URL("./fixtures/emsc-fdsn.json", import.meta.url), "utf8");
const CONFIG = { minMagnitude: 3.5, urgentMinMagnitude: 4.5 };

describe("EMSC", () => {
  it("normaliza sismos, descarta voladuras y magnitudes bajas", () => {
    const items = emsc.parse(body, CONFIG);
    expect(items.map((i) => i.externalId)).toEqual(["20260929_0000101", "20260929_0000102"]);
    expect(items[0]).toMatchObject({
      categoryCode: "natural.earthquake", point: { lat: -12.45, lng: -76.21 }, severity: 3,
      occurredAt: "2026-09-29T10:03:21.400Z", publishedAt: "2026-09-29T10:12:00.000Z",
      title: { es: "Sismo M5.4 · Near Coast Of Central Peru" },
      link: "https://www.seismicportal.eu/eventdetails.html?unid=20260929_0000101",
      raw: { mag: 5.4, depthKm: 35, auth: "IGP" },
    });
    expect(emsc.isUrgent(items[0]!, CONFIG)).toBe(true);
    expect(emsc.isUrgent(items[1]!, CONFIG)).toBe(false);
  });

  it("rechaza documentos que no son del formato", () => {
    expect(() => emsc.parse("{\"type\":\"Other\"}", CONFIG)).toThrow(/EMSC/);
    expect(emsc.parse(JSON.stringify({ type: "FeatureCollection", features: [{ properties: { mag: 6 } }] }), CONFIG)).toEqual([]);
  });
});

describe("registro de la fuente", () => {
  let t: TestContext;
  beforeAll(async () => { t = await createTestContext(); });
  afterAll(async () => { await t.close(); });

  it("queda registrada como externa y PLANNED: no se consulta hasta revisar términos", async () => {
    const { rows } = await t.c.db.query<{ type: string; trust_tier: string; status: string; adapter: string }>(
      `SELECT type, trust_tier, status, adapter FROM ingestion.sources WHERE key = 'emsc-earthquakes'`,
    );
    expect(rows[0]).toEqual({ type: "EXTERNAL", trust_tier: "EXTERNAL", status: "PLANNED", adapter: "emsc-fdsn-json" });
  });
});
