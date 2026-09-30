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
    expect(await t.c.identity.applyRetention(t.c.db, new Date())).toEqual({ emailChallenges: 1, mfaFailures: 1 });
    const left = async (table: string) => (await t.c.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM identity.${table}`)).rows[0]!.n;
    expect(await left("email_challenges")).toBe(1);
    expect(await left("mfa_failures")).toBe(1);
  });
});
