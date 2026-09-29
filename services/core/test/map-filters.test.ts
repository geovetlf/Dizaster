import type { EventMapResponse } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, LIMA, offset, reportBody, submit, type TestContext } from "./helpers.js";

let t: TestContext;
let citizen: string;
let official: string;
const map = async (extra = "") => ((await t.app.inject({ url: `/v1/events?bbox=-78,-13,-76,-11&zoom=15${extra}` })).json() as EventMapResponse).events.map((e) => e.id);

beforeAll(async () => {
  t = await createTestContext();
  await t.c.ingestion.setSourceStatus("usgs-earthquakes", "ACTIVE");
  const u = await createUser(t, "vecino_mapa");
  citizen = (await submit(t, u, reportBody(u, { category: "fire.structure", pin: LIMA }))).body.eventId!;
  const now = new Date().toISOString();
  const r = await t.c.ingestion.ingest("usgs-earthquakes", {
    externalId: "us-map-1", categoryCode: "natural.earthquake", point: offset(LIMA, 20_000), uncertaintyM: 5000,
    occurredAt: now, publishedAt: now, title: { es: "Sismo" }, severity: 4, assertion: "OCCURRING", raw: {},
  }, "URGENT");
  official = r.resolution && "eventId" in r.resolution ? r.resolution.eventId : "";
  await t.c.dispatcher.drain();
});
afterAll(() => t.close());

describe("filtros del mapa (ADR 0057)", () => {
  it("sin filtros muestra ambos; 'solo verificados' deja el oficial", async () => {
    expect(await map()).toEqual(expect.arrayContaining([citizen, official]));
    const verified = await map("&verified=1");
    expect(verified).toContain(official);
    expect(verified).not.toContain(citizen);
  });

  it("filtra por categoría raíz y valida el parámetro", async () => {
    expect(await map("&categories=fire")).toEqual([citizen]);
    expect((await t.app.inject({ url: "/v1/events?bbox=-78,-13,-76,-11&zoom=15&verified=si" })).statusCode).toBe(400);
  });
});
