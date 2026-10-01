import type { ModeratorEventDetail } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, reportBody, submit, type TestContext, type TestUser } from "./helpers.js";

// Historial del evento para moderación: lo reciente por defecto, todo a pedido y con totales (ADR 0302). NO AI REQUIRED.
let t: TestContext;
async function asModerator(handle: string): Promise<TestUser> {
  const u = await createUser(t, handle);
  await t.c.identity.grantRole(u.userId, "moderator");
  const token = (await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle, platform: "ANDROID", deviceId: u.deviceId } })).json().token as string;
  return { ...u, token };
}
beforeAll(async () => { t = await createTestContext(); });
afterAll(() => t.close());

describe("historial completo del evento", () => {
  it("por defecto lo reciente con el total real; con history=full, todo", async () => {
    const reporter = await createUser(t, "hist_rep");
    const eventId = (await submit(t, reporter, reportBody(reporter, { category: "accident.traffic" }))).body.eventId!;
    await t.c.db.query(
      `INSERT INTO event.status_log (id, event_id, from_status, to_status, reason, actor, at)
       SELECT gen_random_uuid(), $1, 'ACTIVE', 'MONITORING', 'cambio de prueba ' || g, 'MODERATOR:x', now() - make_interval(mins => g)
         FROM generate_series(1, 25) g`,
      [eventId],
    );
    const mod = await asModerator("hist_mod");
    const headers = { authorization: `Bearer ${mod.token}` };

    const recent = (await t.app.inject({ url: `/v1/moderation/events/${eventId}`, headers })).json() as ModeratorEventDetail;
    expect(recent.statusChanges).toHaveLength(20);
    expect(recent.statusChanges[0]!.reason).toBe("cambio de prueba 1");
    expect(recent.historyTotals).toMatchObject({ statusChanges: 25, evidence: 1, notes: 0, merges: 0 });

    const full = (await t.app.inject({ url: `/v1/moderation/events/${eventId}?history=full`, headers })).json() as ModeratorEventDetail;
    expect(full.statusChanges).toHaveLength(25);
    expect(full.statusChanges.at(-1)!.reason).toBe("cambio de prueba 25");

    expect((await t.app.inject({ url: `/v1/moderation/events/${eventId}?history=todo`, headers })).statusCode).toBe(400);
    expect((await t.app.inject({ url: `/v1/moderation/events/${eventId}?history=full`, headers: { authorization: `Bearer ${reporter.token}` } })).statusCode).toBe(403);
  });
});
