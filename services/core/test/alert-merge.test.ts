import type { NotificationsResponse } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NormalizedItem } from "../src/modules/ingestion/index.js";
import { withTransaction } from "../src/platform/db.js";
import { actAsOfficial, createTestContext, createUser, LIMA, offset, type TestContext, type TestUser } from "./helpers.js";

// ADR 0249: quien fue avisado de un evento que se fusionó en otro sigue enterándose de lo que pasa.
describe("fusión y avisos", () => {
  let t: TestContext;
  let u: TestUser;
  beforeAll(async () => {
    t = await createTestContext();
    await t.c.ingestion.setSourceStatus("usgs-earthquakes", "ACTIVE");
    await actAsOfficial(t, "usgs-earthquakes");
    u = await createUser(t, "avisada_fusion");
    await t.app.inject({ method: "PUT", url: "/v1/me/alert-preferences", headers: { authorization: `Bearer ${u.token}` }, payload: { nearMe: true } });
  });
  afterAll(async () => { await t.close(); });

  const quake = async (id: string, p: { lat: number; lng: number }) => {
    const now = new Date().toISOString();
    const r = await t.c.ingestion.ingest("usgs-earthquakes", {
      externalId: id, categoryCode: "natural.earthquake", point: p, uncertaintyM: 1000, occurredAt: now, publishedAt: now,
      title: { es: "Sismo" }, severity: 4, assertion: "OCCURRING", raw: {},
    } as NormalizedItem, "URGENT");
    await t.c.dispatcher.drain();
    return (r.resolution as { eventId: string }).eventId;
  };
  const inbox = async () => (await t.app.inject({ url: "/v1/me/notifications", headers: { authorization: `Bearer ${u.token}` } })).json() as NotificationsResponse;

  it("tras fusionar, el cierre del evento que quedó llega a quien fue avisado del absorbido", async () => {
    const near = offset(LIMA, 5000);
    await t.app.inject({ method: "PUT", url: "/v1/me/approximate-location", headers: { authorization: `Bearer ${u.token}` }, payload: offset(near, 100) });
    const absorbed = await quake("fus-a", near);
    expect((await inbox()).notifications.some((n) => n.eventId === absorbed)).toBe(true);
    // La persona se aleja: del otro evento no la avisaría "cerca de mí".
    await t.app.inject({ method: "PUT", url: "/v1/me/approximate-location", headers: { authorization: `Bearer ${u.token}` }, payload: offset(LIMA, 900_000) });
    const target = await quake("fus-b", offset(LIMA, 400_000));
    expect((await inbox()).notifications.some((n) => n.eventId === target)).toBe(false);

    await withTransaction(t.c.db, (tx) => t.c.events.merge(tx, target, absorbed, "moderator:x", "Mismo sismo, dos fuentes"));
    await t.c.dispatcher.drain();
    // Ya se había avisado del incidente: no se anuncia otra vez como nuevo.
    expect((await inbox()).notifications.filter((n) => n.eventId === target && n.kind === "NEW_EVENT")).toHaveLength(0);

    await withTransaction(t.c.db, (tx) => t.c.events.setStatus(tx, target, "RESOLVED", "moderator:x", "Terminó"));
    await t.c.dispatcher.drain();
    const closing = (await inbox()).notifications.filter((n) => n.eventId === target);
    expect(closing.map((n) => n.kind)).toContain("RESOLVED");
  });
});
