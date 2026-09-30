import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { publish } from "../src/platform/outbox.js";
import { createTestContext, createUser, type TestContext } from "./helpers.js";

// Retención de datos operativos (ADR 0165). NO AI REQUIRED.
let t: TestContext;
beforeAll(async () => { t = await createTestContext(); });
afterAll(() => t.close());

describe("retención de datos operativos", () => {
  it("borra ubicaciones de más de 72 h, avisos viejos y outbox procesado; nunca lo pendiente", async () => {
    const [a, b] = await Promise.all([createUser(t, "ret_a"), createUser(t, "ret_b")]);
    await t.c.db.query(
      `INSERT INTO alert.last_locations (profile_id, center, seen_at) VALUES
         ($1, ST_SetSRID(ST_MakePoint(-77.03, -12.05), 4326)::geography, now() - interval '4 days'),
         ($2, ST_SetSRID(ST_MakePoint(-77.03, -12.05), 4326)::geography, now() - interval '1 hour')`,
      [a.profileId, b.profileId],
    );
    const alertId = crypto.randomUUID();
    await t.c.db.query(
      `INSERT INTO alert.alerts (id, event_id, kind, dedup_key, category_code, severity, public_state) VALUES ($1, gen_random_uuid(), 'NEW_EVENT', $2, 'fire.structure', 3, 'UNVERIFIED')`,
      [alertId, `ret:${alertId}`],
    );
    await t.c.db.query(
      `INSERT INTO alert.notifications (id, alert_id, profile_id, user_id, match, title, body, status, created_at) VALUES
         (gen_random_uuid(), $1, $2, $3, 'CATEGORY', 't', 'b', 'SENT', now() - interval '120 days'),
         (gen_random_uuid(), $1, $4, $5, 'CATEGORY', 't', 'b', 'SENT', now() - interval '10 days')`,
      [alertId, a.profileId, a.userId, b.profileId, b.userId],
    );
    expect(await t.c.alerts.applyRetention(90)).toEqual({ lastLocations: 1, notifications: 1 });
    const left = await t.c.db.query(`SELECT profile_id FROM alert.last_locations WHERE profile_id = ANY($1)`, [[a.profileId, b.profileId]]);
    expect(left.rows.map((r) => r.profile_id)).toEqual([b.profileId]);
    // La alerta se conserva: su dedup_key evita repetir el aviso.
    expect((await t.c.db.query(`SELECT 1 FROM alert.alerts WHERE id = $1`, [alertId])).rowCount).toBe(1);

    await publish(t.c.db, "AppealDecided", { appealId: crypto.randomUUID(), appellantUserId: a.userId, outcome: "REVERSED" });
    await t.c.dispatcher.drain();
    await publish(t.c.db, "AppealDecided", { appealId: crypto.randomUUID(), appellantUserId: a.userId, outcome: "UPHELD" });
    await t.c.db.query(`UPDATE platform.outbox SET processed_at = now() - interval '20 days' WHERE processed_at IS NOT NULL`);
    const pendingBefore = (await t.c.dispatcher.backlog()).pending;
    expect(pendingBefore).toBeGreaterThan(0);
    const deleted = await t.c.dispatcher.purgeProcessed(14);
    expect(deleted).toBeGreaterThan(0);
    expect((await t.c.db.query(`SELECT 1 FROM platform.outbox WHERE processed_at IS NOT NULL`)).rowCount).toBe(0);
    expect((await t.c.dispatcher.backlog()).pending).toBe(pendingBefore);
  });
});
