import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inOfficialScope, type NormalizedItem } from "../src/modules/ingestion/index.js";
import { createTestContext, LIMA, offset, type TestContext } from "./helpers.js";

describe("ámbito de una fuente oficial (D-PTWC, ADR 0060)", () => {
  const ptwc = { categories: ["natural.tsunami"], country_scope: ["*"] };
  const igp = { categories: ["natural.earthquake"], country_scope: ["PE"] };

  it("solo la categoría y el país de su ámbito", () => {
    expect(inOfficialScope(ptwc, "natural.tsunami", "CL")).toBe(true);
    expect(inOfficialScope(ptwc, "natural.tsunami", null)).toBe(true);
    expect(inOfficialScope(ptwc, "natural.earthquake", "PE")).toBe(false);
    expect(inOfficialScope(igp, "natural.earthquake", "PE")).toBe(true);
    expect(inOfficialScope(igp, "natural.earthquake", "EC")).toBe(false);
    expect(inOfficialScope(igp, "natural.earthquake", null)).toBe(false);
    expect(inOfficialScope({ categories: ["natural"], country_scope: ["*"] }, "natural.flood", "PE")).toBe(true);
  });

  describe("en la verificación", () => {
    let t: TestContext;
    beforeAll(async () => {
      t = await createTestContext();
      await t.c.ingestion.syncRegistry(t.c.ref.sources);
      await t.c.db.query(`UPDATE ingestion.sources SET status = 'ACTIVE' WHERE key IN ('ptwc-tsunami', 'usgs-earthquakes')`);
    });
    afterAll(() => t.close());
    const item = (externalId: string, categoryCode: string, point: { lat: number; lng: number }): NormalizedItem => ({
      externalId, categoryCode: categoryCode as NormalizedItem["categoryCode"], point, uncertaintyM: 20_000, occurredAt: new Date().toISOString(),
      publishedAt: new Date().toISOString(), title: { en: "x" }, severity: 4, assertion: "OCCURRING", raw: {},
    });
    const level = async (eventId: string) =>
      (await t.c.db.query<{ level: string }>(`SELECT level FROM verification.state WHERE event_id = $1`, [eventId])).rows[0]?.level;

    it("PTWC es fuente externa (D-PTWC-2, ADR 0109): corrobora un tsunami, no lo confirma", async () => {
      const r = await t.c.ingestion.ingest("ptwc-tsunami", item("ptwc-1", "natural.tsunami", offset(LIMA, -100_000, -50_000)), "URGENT");
      await t.c.dispatcher.drain();
      const id = r.resolution && "eventId" in r.resolution ? r.resolution.eventId : "";
      expect(await level(id)).toBe("EXTERNALLY_CORROBORATED");
    });

    it("una fuente oficial confirma dentro de su ámbito", async () => {
      const r = await t.c.ingestion.ingest("usgs-earthquakes", item("usgs-1", "natural.earthquake", offset(LIMA, 500_000)), "URGENT");
      await t.c.dispatcher.drain();
      const id = r.resolution && "eventId" in r.resolution ? r.resolution.eventId : "";
      expect(await level(id)).toBe("OFFICIALLY_CONFIRMED");
    });

    it("una fuente oficial fuera de su categoría solo corrobora externamente", async () => {
      const r = await t.c.ingestion.ingest("usgs-earthquakes", item("usgs-2", "natural.tsunami", offset(LIMA, 300_000)), "URGENT");
      await t.c.dispatcher.drain();
      const id = r.resolution && "eventId" in r.resolution ? r.resolution.eventId : "";
      expect(await level(id)).toBe("EXTERNALLY_CORROBORATED");
    });
  });
});
