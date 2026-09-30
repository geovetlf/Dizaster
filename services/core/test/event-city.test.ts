import type { NotificationsResponse } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NormalizedItem } from "../src/modules/ingestion/index.js";
import { createTestContext, createUser, seedGeoFixtures, type TestContext, type TestUser } from "./helpers.js";

// Ciudad del evento (ADR 0175, §7 city_id). NO AI REQUIRED.
let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
  await seedGeoFixtures(t);
  await t.c.ingestion.setSourceStatus("usgs-earthquakes", "ACTIVE");
});
afterAll(async () => { await t.close(); });

const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });

describe("ciudad del evento", () => {
  it("se deriva del lugar contextual y sirve para búsqueda, avisos y el feed de lugares seguidos", async () => {
    const c = (await t.c.db.query<{ lat: number; lng: number }>(
      `SELECT ST_Y(ST_PointOnSurface(geom)) AS lat, ST_X(ST_PointOnSurface(geom)) AS lng FROM geo.admin_areas WHERE id = 'PE:150122'`,
    )).rows[0]!;
    const now = new Date().toISOString();
    const item: NormalizedItem = {
      externalId: "us-city-1", categoryCode: "natural.earthquake", point: c, uncertaintyM: 100, occurredAt: now, publishedAt: now,
      title: { es: "Sismo" }, severity: 4, assertion: "OCCURRING", raw: {},
    };
    // Primero se sigue la ciudad (provincia), luego llega el evento.
    const probe = await t.c.geo.contextFor(t.c.db, c, "NORMAL");
    const cityId = probe?.city?.id;
    expect(cityId).toBeTruthy();
    const u = await createUser(t, "city_follow");
    expect((await t.app.inject({ method: "PUT", url: `/v1/follows/place/${cityId}`, headers: auth(u) })).statusCode).toBe(200);

    const r = await t.c.ingestion.ingest("usgs-earthquakes", item, "URGENT");
    const eventId = (r.resolution as { eventId: string }).eventId;
    await t.c.dispatcher.drain();

    const row = (await t.c.db.query<{ city_id: string | null }>(`SELECT city_id FROM event.events WHERE id = $1`, [eventId])).rows[0]!;
    expect(row.city_id).toBe(cityId);
    const sig = (await t.c.db.query<{ city_id: string | null }>(`SELECT city_id FROM social.event_signals WHERE event_id = $1`, [eventId])).rows[0];
    expect(sig?.city_id).toBe(cityId);

    const inbox = (await t.app.inject({ url: "/v1/me/notifications", headers: auth(u) })).json() as NotificationsResponse;
    expect(inbox.notifications.filter((n) => n.eventId === eventId).map((n) => n.match)).toContain("FOLLOWED_PLACE");
  });
});
