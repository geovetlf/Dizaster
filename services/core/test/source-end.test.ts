import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FEED_ADAPTERS, type NormalizedItem } from "../src/modules/ingestion/index.js";
import { createTestContext, createUser, LIMA, offset, reportBody, submit, type TestContext } from "./helpers.js";

let t: TestContext;
const status = async (id: string) => (await t.c.db.query<{ status: string }>(`SELECT status FROM event.events WHERE id = $1`, [id])).rows[0]!.status;
const quake = (externalId: string, point: { lat: number; lng: number }, over: Partial<NormalizedItem> = {}): NormalizedItem => ({
  externalId, categoryCode: "natural.earthquake", point, uncertaintyM: 5000, occurredAt: new Date().toISOString(),
  publishedAt: new Date().toISOString(), title: { es: "Sismo" }, severity: 4, assertion: "OCCURRING", raw: {}, ...over,
});
const eventOf = (r: Awaited<ReturnType<TestContext["c"]["ingestion"]["ingest"]>>) => (r.resolution && "eventId" in r.resolution ? r.resolution.eventId : "");
const run = async () => t.c.events.applySourceEnd(t.c.db, await t.c.ingestion.endedItems(t.c.db, new Date()));

beforeAll(async () => {
  t = await createTestContext();
  await t.c.ingestion.setSourceStatus("usgs-earthquakes", "ACTIVE");
});
afterAll(() => t.close());

describe("fin oficial de un evento (ADR 0059)", () => {
  it("el adaptador CAP devuelve las alertas canceladas por su mensaje original", () => {
    const cap = FEED_ADAPTERS.get("cap-1.2")!;
    expect(cap.withdrawals?.(readFileSync(new URL("./fixtures/cap-atom.xml", import.meta.url), "utf8"), {})).toEqual(["EJ-X"]);
  });

  it("una alerta retirada cierra un evento que solo sostenía esa fuente", async () => {
    const id = eventOf(await t.c.ingestion.ingest("usgs-earthquakes", quake("end-w-1", offset(LIMA, -60_000)), "NORMAL"));
    await t.c.dispatcher.drain();
    expect(await t.c.ingestion.withdraw("usgs-earthquakes", "end-w-1", new Date(Date.now() - 1000))).toBe(true);
    expect(await t.c.ingestion.withdraw("usgs-earthquakes", "end-w-1", new Date())).toBe(false);
    expect(await run()).toBeGreaterThanOrEqual(1);
    expect(await status(id)).toBe("RESOLVED");
    const tl = (await t.app.inject({ url: `/v1/events/${id}/timeline` })).json().entries as { type: string; payload: { cause?: string } }[];
    expect(tl.some((e) => e.type === "STATUS_CHANGED" && e.payload.cause === "SOURCE_WITHDRAWN")).toBe(true);
  });

  it("una alerta expirada no cierra el evento si hay un reporte ciudadano", async () => {
    const pin = offset(LIMA, 80_000);
    const r = await t.c.ingestion.ingest("usgs-earthquakes", quake("end-e-1", pin, { endsAt: new Date(Date.now() - 60_000).toISOString() }), "NORMAL");
    const id = eventOf(r);
    await t.c.dispatcher.drain();
    const u = await createUser(t, "testigo_sismo");
    const rep = await submit(t, u, reportBody(u, { category: "natural.earthquake", pin }));
    expect(rep.body.eventId).toBe(id);
    await t.c.dispatcher.drain();
    await run();
    expect(await status(id)).toBe("ACTIVE");
  });

  it("una alerta vigente no cierra nada", async () => {
    const id = eventOf(await t.c.ingestion.ingest("usgs-earthquakes", quake("end-v-1", offset(LIMA, -150_000), { endsAt: new Date(Date.now() + 3600_000).toISOString() }), "NORMAL"));
    await t.c.dispatcher.drain();
    await run();
    expect(await status(id)).toBe("ACTIVE");
  });
});
