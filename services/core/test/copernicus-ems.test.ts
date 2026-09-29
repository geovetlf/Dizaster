import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FEED_ADAPTERS } from "../src/modules/ingestion/index.js";
import { createTestContext, type TestContext } from "./helpers.js";

// Copernicus EMS, cartografía rápida (ADR 0120). NO AI REQUIRED. La fuente queda PLANNED hasta revisar sus términos.
const ems = FEED_ADAPTERS.get("copernicus-ems-georss")!;
const body = readFileSync(new URL("./fixtures/copernicus-ems.xml", import.meta.url), "utf8");

describe("Copernicus EMS", () => {
  it("normaliza activaciones con punto o polígono y descarta lo que no encaja en la taxonomía", () => {
    const items = ems.parse(body, {});
    expect(items.map((i) => i.externalId)).toEqual(["EMSR812", "EMSR813"]);
    expect(items[0]).toMatchObject({
      categoryCode: "natural.flood", point: { lat: -5.19, lng: -80.63 }, uncertaintyM: 25_000, severity: 4, assertion: "OCCURRING",
      occurredAt: "2026-09-29T06:30:00.000Z", title: { en: "[EMSR812] Peru: Flood in Piura" },
      link: "https://emergency.copernicus.eu/mapping/list-of-components/EMSR812", raw: { emsr: "EMSR812", country: "Peru" },
    });
    // Forest fire por el título; punto = centro de la caja del polígono.
    expect(items[1]!.categoryCode).toBe("fire.wildfire");
    expect(items[1]!.point!.lat).toBeCloseTo(-33, 5);
    expect(items[1]!.point!.lng).toBeCloseTo(-71.5, 5);
    expect(items[1]!.uncertaintyM).toBeGreaterThanOrEqual(25_000);
    expect(items[1]!.raw["country"]).toBe("Chile");
    // Una activación llega horas después: nunca por el carril urgente.
    expect(items.some((i) => ems.isUrgent(i, {}))).toBe(false);
  });

  it("rechaza documentos que no son RSS", () => {
    expect(() => ems.parse("<feed/>", {})).toThrow(/Copernicus/);
    expect(ems.parse("<rss><channel></channel></rss>", {})).toEqual([]);
  });
});

describe("registro de la fuente", () => {
  let t: TestContext;
  beforeAll(async () => { t = await createTestContext(); });
  afterAll(async () => { await t.close(); });

  it("queda registrada como externa y PLANNED, sin carril urgente", async () => {
    const { rows } = await t.c.db.query<{ type: string; trust_tier: string; status: string; adapter: string; urgent_capable: boolean }>(
      `SELECT type, trust_tier, status, adapter, urgent_capable FROM ingestion.sources WHERE key = 'copernicus-ems'`,
    );
    expect(rows[0]).toEqual({ type: "EXTERNAL", trust_tier: "EXTERNAL", status: "PLANNED", adapter: "copernicus-ems-georss", urgent_capable: false });
  });
});
