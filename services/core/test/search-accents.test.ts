import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NormalizedItem } from "../src/modules/ingestion/index.js";
import { createTestContext, type TestContext } from "./helpers.js";

// ADR 0247: buscar en títulos de fuentes sin distinguir tildes ni ñ.
describe("búsqueda de eventos con tildes", () => {
  let t: TestContext;
  let eventId = "";
  beforeAll(async () => {
    t = await createTestContext();
    await t.c.ingestion.setSourceStatus("usgs-earthquakes", "ACTIVE");
    const now = new Date().toISOString();
    const r = await t.c.ingestion.ingest("usgs-earthquakes", {
      externalId: "tilde-1", categoryCode: "natural.earthquake", point: { lat: -13.08, lng: -76.39 }, uncertaintyM: 5000,
      occurredAt: now, publishedAt: now, title: { es: "Sismo M4.6 · Cañete, Perú" }, severity: 3, assertion: "OCCURRING", raw: {},
    } as NormalizedItem, "NORMAL");
    eventId = (r.resolution as { eventId: string }).eventId;
    await t.c.db.query(`UPDATE event.events SET publication_state = 'PUBLISHED' WHERE id = $1`, [eventId]);
  });
  afterAll(async () => { await t.close(); });

  const find = async (q: string) => ((await t.app.inject({ url: `/v1/search/events?q=${encodeURIComponent(q)}` })).json().events as { id: string }[]).map((e) => e.id);

  it("encuentra el título con ñ escribiendo con o sin ella", async () => {
    expect(await find("Cañete")).toContain(eventId);
    expect(await find("canete")).toContain(eventId);
    expect(await find("CANETE peru")).toContain(eventId);
  });

  it("la función SQL coincide con searchKey", async () => {
    const { rows } = await t.c.db.query<{ k: string }>(`SELECT platform.search_key('  Jesús María, ¡Ñuñoa!  ') AS k`);
    expect(rows[0]!.k).toBe("jesus maria nunoa");
  });
});
