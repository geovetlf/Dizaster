import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, LIMA, offset, reportBody, submit, type TestContext } from "./helpers.js";

// Auditoría inmutable (ADR 0113).
let t: TestContext;
beforeAll(async () => { t = await createTestContext(); });
afterAll(() => t.close());

describe("auditoría inmutable", () => {
  it("las transiciones de verificación y las acciones de moderación no se editan ni se borran", async () => {
    const u = await createUser(t, "audit_inm");
    const r = await submit(t, u, reportBody(u, { category: "fire.structure", pin: offset(LIMA, 1200) }));
    const eventId = r.body.eventId!;
    await t.c.db.query(
      `INSERT INTO verification.transitions (id, event_id, from_level, to_level, from_negative, to_negative, cause, evidence_ids, actor, reason)
       VALUES (gen_random_uuid(), $1, 'UNVERIFIED', 'UNVERIFIED', 'NONE', 'DISPUTED', 'MODERATOR', ARRAY[gen_random_uuid()], 'moderator:x', 'motivo de prueba')`, [eventId],
    );
    await expect(t.c.db.query(`UPDATE verification.transitions SET reason = 'otro' WHERE event_id = $1`, [eventId])).rejects.toThrow(/solo se inserta/);
    await expect(t.c.db.query(`DELETE FROM verification.transitions WHERE event_id = $1`, [eventId])).rejects.toThrow(/solo se inserta/);
    const act = await t.c.db.query<{ id: string }>(
      `INSERT INTO moderation.actions (id, target_type, target_id, action, actor, reason) VALUES (gen_random_uuid(), 'POST', $1, 'HIDE', 'RULE', 'regla') RETURNING id`,
      [r.body.postId],
    );
    await expect(t.c.db.query(`UPDATE moderation.actions SET reason = 'otra' WHERE id = $1`, [act.rows[0]!.id])).rejects.toThrow(/solo se inserta/);
    await expect(t.c.db.query(`DELETE FROM moderation.actions WHERE id = $1`, [act.rows[0]!.id])).rejects.toThrow(/solo se inserta/);
  });

  it("el registro de fusiones solo acepta la reversión, una vez", async () => {
    const u = await createUser(t, "audit_merge");
    const a = (await submit(t, u, reportBody(u, { category: "fire.structure", pin: offset(LIMA, 30_000) }))).body.eventId!;
    const b = (await submit(t, u, reportBody(u, { category: "accident.traffic", pin: offset(LIMA, 40_000) }))).body.eventId!;
    const { rows } = await t.c.db.query<{ id: string }>(
      `INSERT INTO event.merge_log (id, target_event_id, merged_event_id, reason, actor) VALUES (gen_random_uuid(), $1, $2, 'prueba', 'RULE') RETURNING id`, [a, b],
    );
    const id = rows[0]!.id;
    await expect(t.c.db.query(`UPDATE event.merge_log SET reason = 'otra' WHERE id = $1`, [id])).rejects.toThrow(/solo se registra la reversión/);
    await t.c.db.query(`UPDATE event.merge_log SET reverted_at = now(), reverted_by = 'MODERATOR:x', revert_reason = 'error' WHERE id = $1`, [id]);
    await expect(t.c.db.query(`UPDATE event.merge_log SET revert_reason = 'otra' WHERE id = $1`, [id])).rejects.toThrow(/una vez/);
    await expect(t.c.db.query(`DELETE FROM event.merge_log WHERE id = $1`, [id])).rejects.toThrow(/no se borra/);
  });
});
