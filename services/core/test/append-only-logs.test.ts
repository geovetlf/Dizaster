import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, reportBody, submit, type TestContext } from "./helpers.js";

describe("registros de eventos y fuentes de solo inserción (ADR 0232)", () => {
  let t: TestContext;
  beforeAll(async () => { t = await createTestContext(); });
  afterAll(async () => { await t.close(); });

  it("los cuatro registros tienen el disparador de solo inserción", async () => {
    const { rows } = await t.c.db.query<{ t: string }>(
      `SELECT c.relnamespace::regnamespace || '.' || c.relname AS t FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid
        WHERE g.tgfoid = 'platform.audit_append_only'::regproc AND NOT g.tgisinternal`,
    );
    expect(rows.map((r) => r.t)).toEqual(expect.arrayContaining(["event.status_log", "event.severity_log", "event.split_log", "ingestion.source_status_log"]));
  });

  it("un cambio de estado registrado no se puede editar ni borrar", async () => {
    const u = await createUser(t, "inmutable_a");
    const r = await submit(t, u, reportBody(u));
    await t.c.db.query(`INSERT INTO event.status_log (id, event_id, from_status, to_status, reason, actor) VALUES (gen_random_uuid(), $1, 'ACTIVE', 'RESOLVED', 'prueba', 'x')`, [r.body.eventId]);
    await expect(t.c.db.query(`UPDATE event.status_log SET reason = 'otro'`)).rejects.toThrow(/solo se inserta/);
    await expect(t.c.db.query(`DELETE FROM event.status_log`)).rejects.toThrow(/solo se inserta/);
  });
});
