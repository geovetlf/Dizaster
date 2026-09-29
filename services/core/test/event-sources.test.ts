import type { EventSourceView } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { safeLink, type NormalizedItem } from "../src/modules/ingestion/index.js";
import { createTestContext, createUser, LIMA, offset, reportBody, submit, type TestContext } from "./helpers.js";

let t: TestContext;
const now = new Date().toISOString();
const quake = (over: Partial<NormalizedItem>): NormalizedItem => ({
  externalId: "us-src-1", categoryCode: "natural.earthquake", point: offset(LIMA, -40_000), uncertaintyM: 5000,
  occurredAt: now, publishedAt: now, title: { es: "Sismo M5.1" }, severity: 4, assertion: "OCCURRING", raw: {}, ...over,
});

beforeAll(async () => {
  t = await createTestContext();
  await t.c.ingestion.setSourceStatus("usgs-earthquakes", "ACTIVE");
});
afterAll(() => t.close());

describe("fuentes visibles en el evento (ADR 0055)", () => {
  it("lista la fuente con licencia y enlace https al original", async () => {
    const r = await t.c.ingestion.ingest("usgs-earthquakes", quake({ link: "https://earthquake.usgs.gov/earthquakes/eventpage/us-src-1" }), "URGENT");
    await t.c.dispatcher.drain();
    const eventId = r.resolution && "eventId" in r.resolution ? r.resolution.eventId : null;
    expect(eventId).toBeTruthy();
    const res = await t.app.inject({ url: `/v1/events/${eventId}/sources` });
    expect(res.statusCode).toBe(200);
    const sources = res.json().sources as EventSourceView[];
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      sourceKey: "usgs-earthquakes", trustTier: "EXTERNAL", link: "https://earthquake.usgs.gov/earthquakes/eventpage/us-src-1",
      title: { es: "Sismo M5.1" }, assertion: "OCCURRING",
    });
    expect(sources[0]!.license).toBeTruthy();
  });

  it("un evento solo ciudadano no tiene fuentes y uno inexistente da 404", async () => {
    const u = await createUser(t, "vecina_fuentes");
    const id = (await submit(t, u, reportBody(u, { category: "fire.structure", pin: offset(LIMA, 5000) }))).body.eventId!;
    await t.c.dispatcher.drain();
    expect((await t.app.inject({ url: `/v1/events/${id}/sources` })).json().sources).toEqual([]);
    expect((await t.app.inject({ url: "/v1/events/00000000-0000-4000-8000-000000000000/sources" })).statusCode).toBe(404);
  });

  it("solo acepta enlaces https", () => {
    expect(safeLink("https://ok.example/a")).toBe("https://ok.example/a");
    expect(safeLink("http://inseguro.example")).toBeNull();
    expect(safeLink("javascript:alert(1)")).toBeNull();
    expect(safeLink("no es url")).toBeNull();
    expect(safeLink(null)).toBeNull();
  });
});
