import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LIMA, createTestContext, createUser, offset, reportBody, submit, type TestContext } from "./helpers.js";

/**
 * Candidatos de deduplicación ordenados por distancia (ADR 0298): con más eventos cercanos que el tope de la consulta,
 * el más cercano no puede quedar fuera por el orden físico de la tabla.
 */
describe("candidatos de deduplicación por distancia (ADR 0298)", () => {
  let t: TestContext;
  beforeAll(async () => { t = await createTestContext(); });
  afterAll(async () => { await t.close(); });

  it("el evento más cercano entra aunque haya más candidatos que el tope", async () => {
    const a = await createUser(t, "order_a");
    const b = await createUser(t, "order_b");
    const c = await createUser(t, "order_c");
    const pin = offset(LIMA, 6000, -6000);
    const first = await submit(t, a, reportBody(a, { pin, category: "crime.theft" }));
    const eventId = first.body.eventId!;
    await t.c.db.query(`UPDATE event.events SET publication_state = 'PUBLISHED' WHERE id = $1`, [eventId]);

    // 120 copias a 400 m (dentro del radio de 500 m), más que los topes de 50 y 40.
    const far = offset(pin, 400, 0);
    const cols = (await t.c.db.query<{ c: string }>(
      `SELECT quote_ident(column_name) AS c FROM information_schema.columns
        WHERE table_schema = 'event' AND table_name = 'events' AND is_generated = 'NEVER' AND column_name <> 'id' ORDER BY ordinal_position`,
    )).rows.map((r) => r.c).join(", ");
    await t.c.db.query(
      `INSERT INTO event.events (id, ${cols}) SELECT gen_random_uuid(), ${cols} FROM event.events, generate_series(1, 120) WHERE id = $1`,
      [eventId],
    );
    const moved = await t.c.db.query(
      `UPDATE event.events SET geom = ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, public_geom = ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography
        WHERE id <> $1 AND first_seen_at = (SELECT first_seen_at FROM event.events WHERE id = $1)`,
      [eventId, far.lng, far.lat],
    );
    expect(moved.rowCount).toBe(120);
    // El evento real se reescribe al final de la tabla: sin orden explícito quedaría detrás de las copias.
    await t.c.db.query(`UPDATE event.events SET geom = geom, public_geom = public_geom WHERE id = $1`, [eventId]);
    await t.c.db.query(`VACUUM ANALYZE event.events`).catch(() => undefined);

    const q = offset(pin, 10, 10);
    const near = await t.app.inject({ url: `/v1/events/nearby?lat=${q.lat}&lng=${q.lng}&category=crime.theft`, headers: { authorization: `Bearer ${b.token}` } });
    expect(near.statusCode).toBe(200);
    expect(near.json().events[0].id).toBe(eventId);

    const joined = await submit(t, c, reportBody(c, { pin: offset(pin, 20, 0), category: "crime.theft" }));
    expect(joined.body.eventId).toBe(eventId);
  });
});
