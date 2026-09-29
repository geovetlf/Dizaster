import type { FeedResponse } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTransaction } from "../src/platform/db.js";
import { RANK_BOOST_HOURS } from "../src/modules/social/index.js";
import { createTestContext, createUser, LIMA, offset, reportBody, submit, type TestContext } from "./helpers.js";

// Ciclo de vida del evento en el orden del feed (§5.3, §6.2, ADR 0124).
describe("feed y ciclo de vida del evento", () => {
  let t: TestContext;
  let older: string;
  let newer: string;
  let olderEvent: string;
  const forYou = async () => ((await t.app.inject({ url: "/v1/feed?tab=for_you" })).json() as FeedResponse).posts.map((p) => p.id);

  beforeAll(async () => {
    t = await createTestContext();
    const a = await createUser(t, "vecina_a");
    const b = await createUser(t, "vecino_b");
    const r1 = await submit(t, a, reportBody(a, { category: "infra.power_outage", pin: LIMA }));
    const r2 = await submit(t, b, reportBody(b, { category: "infra.water_outage", pin: offset(LIMA, 8000) }));
    older = r1.body.postId!;
    newer = r2.body.postId!;
    olderEvent = r1.body.eventId!;
    await t.c.dispatcher.drain();
    // El reporte más antiguo va 1 h por delante de lo que el nuevo le saca: sin ciclo de vida, gana el antiguo.
    await t.c.db.query(`UPDATE social.posts SET created_at = now() - interval '1 hour' WHERE id = $1`, [older]);
    await t.c.db.query(`UPDATE social.event_signals SET severity = 3 WHERE event_id = $1`, [olderEvent]);
  });
  afterAll(async () => t.close());

  it("un evento resuelto deja de empujar sus posts; el ciclo de vida llega al feed por dominio", async () => {
    expect((await forYou()).indexOf(older)).toBeLessThan((await forYou()).indexOf(newer));
    await withTransaction(t.c.db, (tx) => t.c.events.setStatus(tx, olderEvent, "RESOLVED", "test", "Servicio restablecido"));
    await t.c.dispatcher.drain();
    const signal = await t.c.db.query<{ lifecycle: string }>(`SELECT lifecycle FROM social.event_signals WHERE event_id = $1`, [olderEvent]);
    expect(signal.rows[0]!.lifecycle).toBe("RESOLVED");
    const order = await forYou();
    expect(order.indexOf(newer)).toBeLessThan(order.indexOf(older));
    expect(RANK_BOOST_HOURS.lifecycle.ARCHIVED).toBeLessThan(RANK_BOOST_HOURS.lifecycle.RESOLVED);
  });
});
