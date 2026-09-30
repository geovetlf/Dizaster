import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NormalizedItem } from "../src/modules/ingestion/index.js";
import { VERIFICATION_RULES_VERSION } from "../src/modules/verification/index.js";
import { LIMA, createTestContext, offset, type TestContext } from "./helpers.js";

// Negación de una fuente externa → DISPUTED, nunca FALSE (ADR 0115).
let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
  await t.c.ingestion.setSourceStatus("usgs-earthquakes", "ACTIVE"); // externa en el registro (ADR 0112)
});
afterAll(() => t.close());

const quake = (externalId: string, point: { lat: number; lng: number }, assertion: NormalizedItem["assertion"]): NormalizedItem => ({
  externalId, categoryCode: "natural.earthquake", point, uncertaintyM: 5000, occurredAt: new Date().toISOString(),
  publishedAt: new Date().toISOString(), title: { en: "M 5.0" }, severity: 3, assertion, raw: {},
});

describe("negación externa", () => {
  it("un sismo retirado por la fuente externa queda en disputa y lo explica", async () => {
    const p = offset(LIMA, -250_000);
    const r = await t.c.ingestion.ingest("usgs-earthquakes", quake("us-ret-1", p, "OCCURRING"), "URGENT");
    await t.c.dispatcher.drain();
    const eventId = (r.resolution as { eventId: string }).eventId;
    const before = (await t.app.inject({ url: `/v1/events/${eventId}/verification` })).json();
    expect(before).toMatchObject({ level: "EXTERNALLY_CORROBORATED", negativeState: "NONE" });

    // USGS retira el sismo con el mismo id (status "deleted"): la misma evidencia pasa a negarlo (ADR 0246).
    await t.c.ingestion.ingest("usgs-earthquakes", quake("us-ret-1", p, "NOT_OCCURRING"), "URGENT");
    await t.c.dispatcher.drain();
    const v = (await t.app.inject({ url: `/v1/events/${eventId}/verification` })).json() as { level: string; negativeState: string; explanation: { code: string }[] };
    expect(v).toMatchObject({ level: "EXTERNALLY_CORROBORATED", negativeState: "DISPUTED" });
    expect(v.explanation.map((e) => e.code)).toContain("EXTERNAL_DENIAL");
    expect(v.explanation.map((e) => e.code)).not.toContain("DISPUTED");
    const { rows } = await t.c.db.query<{ rule_id: string; cause: string }>(
      `SELECT rule_id, cause FROM verification.transitions WHERE event_id = $1 AND to_negative = 'DISPUTED'`, [eventId],
    );
    expect(rows).toEqual([{ rule_id: "external-denial", cause: "RULE" }]);
    expect(VERIFICATION_RULES_VERSION).toBe("verification-4");
  });
});
