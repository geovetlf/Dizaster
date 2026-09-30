import type { EventDetail } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, LIMA, reportBody, submit, type TestContext } from "./helpers.js";

// Hora del suceso en el evento (§7.3 occurred_start, ADR 0224). NO AI REQUIRED.
let t: TestContext;
beforeAll(async () => { t = await createTestContext(); });
afterAll(() => t.close());

describe("startedAt", () => {
  it("el evento expone la hora del suceso, anterior o igual a su detección", async () => {
    const u = await createUser(t, "hora_suceso");
    const r = await submit(t, u, reportBody(u, { pin: LIMA }));
    await t.c.db.query(`UPDATE event.events SET occurred_start = first_seen_at - interval '3 hours' WHERE id = $1`, [r.body.eventId]);
    const e = (await t.app.inject({ url: `/v1/events/${r.body.eventId}` })).json() as EventDetail;
    expect(Date.parse(e.firstSeenAt) - Date.parse(e.startedAt!)).toBe(3 * 3600_000);
  });
});
