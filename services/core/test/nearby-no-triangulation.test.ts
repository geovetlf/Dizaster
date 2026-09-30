import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LIMA, createTestContext, createUser, offset, reportBody, submit, type TestContext } from "./helpers.js";

describe("eventos cercanos sin triangulación (ADR 0230)", () => {
  let t: TestContext;
  beforeAll(async () => { t = await createTestContext(); });
  afterAll(async () => { await t.close(); });

  it("la respuesta solo depende de la ubicación pública: mover el punto interno no cambia nada", async () => {
    const a = await createUser(t, "trian_a");
    const b = await createUser(t, "trian_b");
    const pin = offset(LIMA, 3000, 3000);
    const r = await submit(t, a, reportBody(a, { pin, category: "crime.theft" }));
    const eventId = r.body.eventId!;
    await t.c.db.query(`UPDATE event.events SET publication_state = 'PUBLISHED' WHERE id = $1`, [eventId]);
    const q = offset(pin, 120, 40);
    const ask = async () => (await t.app.inject({ url: `/v1/events/nearby?lat=${q.lat}&lng=${q.lng}&category=crime.theft`, headers: { authorization: `Bearer ${b.token}` } })).json();
    const first = await ask();
    expect(first.events.map((e: { id: string }) => e.id)).toContain(eventId);
    expect(JSON.stringify(first)).not.toContain("matchScore");
    // El punto interno se mueve dentro de su celda pública: la respuesta es idéntica.
    const moved = offset(pin, 60, -60);
    await t.c.db.query(`UPDATE event.events SET geom = ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography WHERE id = $1`, [eventId, moved.lng, moved.lat]);
    expect(await ask()).toEqual(first);
  });
});
