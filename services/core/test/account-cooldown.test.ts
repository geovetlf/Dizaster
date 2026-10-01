import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AccountCooldown, pruneCooldowns } from "../src/platform/rate-limit.js";
import { createTestContext, createUser, type TestContext } from "./helpers.js";

describe("espera entre exportaciones compartida y acotada (ADR 0290)", () => {
  let t: TestContext;
  beforeAll(async () => { t = await createTestContext(); });
  afterAll(async () => { await t.close(); });

  it("dos réplicas comparten la espera; al vencer se puede repetir y la fila se borra", async () => {
    const id = "0192a000-0000-7000-8000-0000000000c1";
    const a = new AccountCooldown(t.c.db, "export", 60);
    const b = new AccountCooldown(t.c.db, "export", 60);
    expect(await a.take(id)).toBeNull();
    const wait = await b.take(id);
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(60);
    // Otra acción de la misma cuenta no comparte la espera.
    expect(await new AccountCooldown(t.c.db, "other", 60).take(id)).toBeNull();

    await t.c.db.query(`UPDATE platform.account_cooldowns SET until = now() - interval '1 second' WHERE user_id = $1`, [id]);
    expect(await pruneCooldowns(t.c.db)).toBeGreaterThanOrEqual(2);
    expect((await t.c.db.query(`SELECT 1 FROM platform.account_cooldowns WHERE user_id = $1`, [id])).rowCount).toBe(0);
    expect(await b.take(id)).toBeNull();
  });

  it("la API responde 429 con Retry-After y no guarda más que el id interno y la hora", async () => {
    const u = await createUser(t, "exporta_dos_veces");
    const auth = { authorization: `Bearer ${u.token}` };
    expect((await t.app.inject({ url: "/v1/me/export", headers: auth })).statusCode).toBe(200);
    const again = await t.app.inject({ url: "/v1/me/export", headers: auth });
    expect(again.statusCode).toBe(429);
    expect(Number(again.headers["retry-after"])).toBeGreaterThan(0);
    const cols = await t.c.db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'platform' AND table_name = 'account_cooldowns'`);
    expect(cols.rows.map((r) => r.column_name).sort()).toEqual(["kind", "until", "user_id"]);
  });
});
