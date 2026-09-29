import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NormalizedItem } from "../src/modules/ingestion/index.js";
import { sourceParams, withStateLines } from "../src/modules/verification/index.js";
import { LIMA, createTestContext, createUser, offset, reportBody, submit, type TestContext } from "./helpers.js";

// Explicación legible completa (Blueprint §10.4, ADR 0086). NO AI REQUIRED.
let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
  await t.c.ingestion.setSourceStatus("nasa-firms", "ACTIVE");
  await t.c.ingestion.setSourceStatus("usgs-earthquakes", "ACTIVE");
});
afterAll(async () => { await t.close(); });

const verification = async (eventId: string) => (await t.app.inject({ url: `/v1/events/${eventId}/verification` })).json();
const codes = (v: { explanation: { code: string }[] }) => v.explanation.map((e) => e.code);

function item(externalId: string, point: { lat: number; lng: number }, over: Partial<NormalizedItem> = {}): NormalizedItem {
  return {
    externalId, categoryCode: "fire.wildfire", point, uncertaintyM: 375, occurredAt: "2026-09-29T14:30:00Z",
    publishedAt: "2026-09-29T14:30:00Z", title: { es: "Foco de calor" }, severity: 3, assertion: "OCCURRING", raw: {}, ...over,
  };
}

describe("explicación de verificación", () => {
  it("nombra la fuente externa y su hora, y dice que falta la confirmación oficial", async () => {
    const pin = offset(LIMA, 80000, 80000);
    const u = await createUser(t, "explica_1");
    const r = await submit(t, u, reportBody(u, { pin, category: "fire.wildfire" }));
    await t.c.ingestion.ingest("nasa-firms", item("firms-explain", offset(pin, 300)), "URGENT");
    await t.c.dispatcher.drain();
    const v = await verification(r.body.eventId!);
    expect(v.level).toBe("EXTERNALLY_CORROBORATED");
    const ext = v.explanation.find((e: { code: string }) => e.code === "EXTERNAL_SOURCES");
    expect(ext.params).toMatchObject({ count: 1, at: "2026-09-29T14:30:00.000Z" });
    expect(ext.params.sources).toMatch(/FIRMS/);
    expect(codes(v).at(-1)).toBe("NOT_OFFICIAL_YET");
  });

  it("confirmado oficialmente: sin la línea de 'todavía no'", async () => {
    const res = await t.c.ingestion.ingest("usgs-earthquakes", item("us-explain", offset(LIMA, -200000), { categoryCode: "natural.earthquake" }), "URGENT");
    await t.c.dispatcher.drain();
    const v = await verification((res.resolution as { eventId: string }).eventId);
    expect(v.level).toBe("OFFICIALLY_CONFIRMED");
    expect(codes(v)).toContain("OFFICIAL_CONFIRMATION");
    expect(codes(v)).not.toContain("NOT_OFFICIAL_YET");
  });

  it("líneas de estado y fuentes", () => {
    expect(withStateLines([], "UNVERIFIED", "FALSE").map((e) => e.code)).toEqual(["MARKED_FALSE"]);
    expect(withStateLines([{ code: "OFFICIAL_DENIAL", params: {} }], "UNVERIFIED", "FALSE").map((e) => e.code)).toEqual(["OFFICIAL_DENIAL"]);
    expect(withStateLines([{ code: "NOT_OFFICIAL_YET", params: {} }], "COMMUNITY_CORROBORATED", "DISPUTED").map((e) => e.code)).toEqual(["DISPUTED", "NOT_OFFICIAL_YET"]);
    const at = (h: number) => new Date(Date.UTC(2026, 8, 29, h));
    expect(sourceParams([
      { sourceName: "A", at: at(1) }, { sourceName: "B", at: at(3) }, { sourceName: "A", at: at(2) },
      { sourceName: "C", at: at(1) }, { sourceName: "D", at: at(1) },
    ])).toEqual({ count: 5, sources: "A, B, C +1", at: at(3).toISOString() });
  });
});
