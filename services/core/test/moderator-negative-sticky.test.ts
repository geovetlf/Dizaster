import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, LIMA, offset, reportBody, submit, type TestContext } from "./helpers.js";

// ADR 0251: una disputa puesta o quitada por moderación no la deshacen las reglas con la siguiente evidencia.
describe("estado negativo decidido por moderación", () => {
  let t: TestContext;
  beforeAll(async () => { t = await createTestContext(); });
  afterAll(async () => { await t.close(); });

  const state = async (id: string) => (await t.c.db.query<{ negative_state: string; negative_source: string }>(
    `SELECT negative_state, negative_source FROM verification.state WHERE event_id = $1`, [id])).rows[0]!;

  it("DISPUTED por moderación sigue DISPUTED cuando llega otro reporte que confirma", async () => {
    const pin = offset(LIMA, 12_000);
    const a = await createUser(t, "disputa_a");
    const r = await submit(t, a, reportBody(a, { pin, category: "accident.traffic" }));
    const eventId = r.body.eventId!;
    await t.c.dispatcher.drain();
    const mod = await createUser(t, "mod_disputa");
    await t.c.verification.moderatorSetNegative({ eventId, moderatorUserId: mod.userId, to: "DISPUTED", reason: "Fotos de otro accidente de 2024", evidenceRefs: [] });
    expect(await state(eventId)).toEqual({ negative_state: "DISPUTED", negative_source: "MODERATOR" });

    const b = await createUser(t, "disputa_b");
    await submit(t, b, reportBody(b, { pin: offset(pin, 30), category: "accident.traffic", targetEventId: eventId }));
    await t.c.dispatcher.drain();
    expect((await state(eventId)).negative_state).toBe("DISPUTED");
  });
});
