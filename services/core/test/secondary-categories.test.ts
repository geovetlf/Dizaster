import type { EventDetail, EventMapResponse, EventSummary } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, LIMA, offset, reportBody, submit, type TestContext } from "./helpers.js";

// Categorías secundarias del evento (§7.3, ADR 0125).
describe("categorías secundarias", () => {
  let t: TestContext;
  let eventId: string;
  let roadReport: string;
  const map = async (extra: string) => ((await t.app.inject({ url: `/v1/events?bbox=-78,-13,-76,-11&zoom=15${extra}` })).json() as EventMapResponse).events.map((e) => e.id);

  beforeAll(async () => {
    t = await createTestContext();
    const a = await createUser(t, "conductora");
    const b = await createUser(t, "peaton");
    const crash = await submit(t, a, reportBody(a, { category: "accident.traffic", pin: LIMA }));
    eventId = crash.body.eventId!;
    // Otra persona, a pocos metros: la vía está cortada por el mismo choque (categorías compatibles).
    const road = await submit(t, b, reportBody(b, { category: "infra.road_blocked", pin: offset(LIMA, 40) }));
    expect(road.body.eventId).toBe(eventId);
    roadReport = road.body.reportId!;
    await t.c.dispatcher.drain();
  });
  afterAll(async () => t.close());

  it("el evento guarda la categoría compatible que aportó otro reporte y se encuentra por ella", async () => {
    const ev = (await t.app.inject({ url: `/v1/events/${eventId}` })).json() as EventDetail;
    expect(ev.categoryCode).toBe("accident.traffic");
    expect(ev.secondaryCategories).toEqual(["infra.road_blocked"]);
    expect(await map("&categories=infra")).toContain(eventId);
    expect(await map("&categories=infra.road_blocked")).toContain(eventId);
    const found = (await t.app.inject({ url: "/v1/search/events?q=bloqueada" })).json() as { events: EventSummary[] };
    expect(found.events.map((e) => e.id)).toContain(eventId);
  });

  it("se recalcula: si el reporte se retira, la categoría secundaria desaparece", async () => {
    const owner = (await t.c.db.query<{ author_user_id: string }>(`SELECT author_user_id FROM report.reports WHERE id = $1`, [roadReport])).rows[0]!;
    await t.c.reports.withdraw({ userId: owner.author_user_id } as never, roadReport);
    const ev = (await t.app.inject({ url: `/v1/events/${eventId}` })).json() as EventDetail;
    expect(ev.secondaryCategories).toEqual([]);
    expect(await map("&categories=infra")).not.toContain(eventId);
  });
});
