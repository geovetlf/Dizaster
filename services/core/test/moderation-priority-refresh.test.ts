import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { publish } from "../src/platform/outbox.js";
import { createTestContext, createUser, LIMA, offset, reportBody, seedGeoFixtures, submit, type TestContext } from "./helpers.js";

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
  await seedGeoFixtures(t);
});
afterAll(() => t.close());

const priorityOf = async (caseId: string) =>
  (await t.c.db.query<{ priority: number }>(`SELECT priority FROM moderation.cases WHERE id = $1`, [caseId])).rows[0]!.priority;

describe("prioridad de casos al día (ADR 0150)", () => {
  it("se recalcula al cambiar la verificación o el ciclo del evento y en el barrido periódico", async () => {
    const autor = await createUser(t, "prio_autor");
    const vecino = await createUser(t, "prio_vecino");
    await submit(t, autor, reportBody(autor, { category: "infra.power_outage", pin: offset(LIMA, 4000), text: "Poste caído en la esquina" }));
    await t.c.dispatcher.drain();
    const post = (await t.c.db.query<{ id: string }>(`SELECT id FROM social.posts WHERE text = $1`, ["Poste caído en la esquina"])).rows[0]!.id;
    const eventId = (await t.c.db.query<{ event_id: string }>(`SELECT event_id FROM social.post_event_links WHERE post_id = $1`, [post])).rows[0]!.event_id;
    expect((await t.app.inject({ method: "POST", url: "/v1/flags", headers: { authorization: `Bearer ${vecino.token}` },
      payload: { targetType: "POST", targetId: post, reason: "SPAM" } })).statusCode).toBe(202);
    const caseId = (await t.c.db.query<{ id: string }>(`SELECT id FROM moderation.cases WHERE target_id = $1 AND status = 'OPEN'`, [post])).rows[0]!.id;
    const initial = await priorityOf(caseId);
    expect(initial).toBeGreaterThan(0);

    // Un cambio de verificación del evento vinculado reordena el caso.
    await t.c.db.query(`UPDATE moderation.cases SET priority = 0 WHERE id = $1`, [caseId]);
    await publish(t.c.db, "VerificationChanged", { eventId, from: "UNVERIFIED", to: "UNVERIFIED", negativeState: "NONE" });
    await t.c.dispatcher.drain();
    expect(await priorityOf(caseId)).toBeCloseTo(initial, 1);

    await t.c.db.query(`UPDATE moderation.cases SET priority = 0 WHERE id = $1`, [caseId]);
    await publish(t.c.db, "EventLifecycleChanged", { eventId, to: "MONITORING" });
    await t.c.dispatcher.drain();
    expect(await priorityOf(caseId)).toBeCloseTo(initial, 1);

    // El barrido del worker recalcula todos los casos abiertos (el alcance crece sin evento de dominio).
    await t.c.db.query(`UPDATE moderation.cases SET priority = 0 WHERE id = $1`, [caseId]);
    const r = await t.c.moderation.refreshPriorities(1);
    expect(r.refreshed).toBeGreaterThanOrEqual(1);
    expect(await priorityOf(caseId)).toBeCloseTo(initial, 1);
  });
});
