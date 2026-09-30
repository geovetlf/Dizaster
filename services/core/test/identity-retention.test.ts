import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, type TestContext } from "./helpers.js";

// Retención de identidad (ADR 0210): códigos de correo y fallos de MFA se borran a las 24 h.
let t: TestContext;
beforeAll(async () => { t = await createTestContext(); });
afterAll(() => t.close());

describe("retención de identidad", () => {
  it("borra códigos de correo y fallos de MFA de más de 24 h y conserva los recientes", async () => {
    const u = await createUser(t, "retencion_id");
    for (const hours of [30, 2]) {
      await t.c.db.query(
        `INSERT INTO identity.email_challenges (id, email_key, code_hash, ip_key, expires_at, created_at)
         VALUES (gen_random_uuid(), 'k', 'h', NULL, now() - make_interval(hours => $1) + interval '10 minutes', now() - make_interval(hours => $1))`, [hours]);
      await t.c.db.query(`INSERT INTO identity.mfa_failures (user_id, at) VALUES ($1, now() - make_interval(hours => $2))`, [u.userId, hours]);
    }
    expect(await t.c.identity.applyRetention(t.c.db, new Date())).toMatchObject({ emailChallenges: 1, mfaFailures: 1 });
    const left = async (table: string) => (await t.c.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM identity.${table}`)).rows[0]!.n;
    expect(await left("email_challenges")).toBe(1);
    expect(await left("mfa_failures")).toBe(1);
  });

  it("purga sesiones caducadas y conserva las vigentes, las rotadas sin caducar y el inicio de cada sesión abierta", async () => {
    const u = await createUser(t, "retencion_ses");
    const ins = (family: string, createdDaysAgo: number, expiresInDays: number, rotated: boolean) => t.c.db.query<{ id: string }>(
      `INSERT INTO identity.sessions (id, family_id, user_id, token_hash, created_at, expires_at, rotated_at)
       VALUES (gen_random_uuid(), $1, $2, gen_random_uuid()::text, now() - make_interval(days => $3), now() + make_interval(days => $4), CASE WHEN $5 THEN now() END)
       RETURNING id`, [family, u.userId, createdDaysAgo, expiresInDays, rotated]).then((r) => r.rows[0]!.id);
    const open = "7c1e0c4a-0000-4000-8000-000000000001";
    const closed = "7c1e0c4a-0000-4000-8000-000000000002";
    const openFirst = await ins(open, 90, -30, true);   // primera fila de una sesión abierta: se conserva
    const openOld = await ins(open, 80, -20, true);     // caducada intermedia: se borra
    const openRotated = await ins(open, 10, 50, true);  // rotada sin caducar: se conserva (reutilización)
    const openLive = await ins(open, 1, 59, false);     // vigente
    const closedA = await ins(closed, 90, -30, true);   // sesión cerrada, todo caducado: se borra entera
    const closedB = await ins(closed, 70, -10, false);
    const { sessions } = await t.c.identity.applyRetention(t.c.db, new Date());
    expect(sessions).toBeGreaterThanOrEqual(3);
    const left = (await t.c.db.query<{ id: string }>(`SELECT id FROM identity.sessions WHERE user_id = $1`, [u.userId])).rows.map((r) => r.id);
    for (const id of [openFirst, openRotated, openLive]) expect(left).toContain(id);
    for (const id of [openOld, closedA, closedB]) expect(left).not.toContain(id);
    const [view] = (await t.c.identity.sessions(u.userId, null)).filter((s) => s.id === open);
    expect(Date.now() - Date.parse(view!.startedAt)).toBeGreaterThan(89 * 86_400_000);
  });
});
