import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SharedAccountLimiter } from "../src/platform/rate-limit.js";
import { createTestContext, createUser, type TestContext } from "./helpers.js";

describe("límite por cuenta compartido entre réplicas (ADR 0228)", () => {
  let t: TestContext;
  beforeAll(async () => { t = await createTestContext({ env: { RATE_LIMIT_SHARED: "true", RATE_LIMIT_PER_MINUTE: "6", RATE_LIMIT_WRITES_PER_MINUTE: "2" } }); });
  afterAll(async () => { await t.close(); });

  it("dos réplicas comparten el mismo cupo; la ventana siguiente empieza de cero y borra la vieja", async () => {
    let now = 120_000;
    const id = "0192a000-0000-7000-8000-000000000001";
    const a = new SharedAccountLimiter(t.c.db, 3, 1, 60_000, () => now);
    const b = new SharedAccountLimiter(t.c.db, 3, 1, 60_000, () => now);
    expect(await a.hit(id, false)).toBeNull();
    expect(await b.hit(id, true)).toBeNull();
    expect(await a.hit(id, true)).toBe(60); // segunda escritura entre las dos réplicas
    expect(await b.hit(id, false)).toBe(60); // cuarta petición
    now = 180_000;
    expect(await b.hit(id, true)).toBeNull();
    const { rows } = await t.c.db.query<{ win: string }>(`SELECT win FROM platform.rate_counters WHERE user_id = $1`, [id]);
    expect(rows.map((r) => Number(r.win))).toEqual([3]);
  });

  it("en la API cuenta por cuenta en la base; sin sesión sigue en memoria y no guarda IPs", async () => {
    const u = await createUser(t, "compartido_a");
    const auth = { authorization: `Bearer ${u.token}` };
    // createUser ya gastó una escritura (declarar la edad).
    const post = () => t.app.inject({ method: "POST", url: "/v1/posts", headers: auth, payload: { text: "hola" } });
    expect((await post()).statusCode).toBe(201);
    const res = await post();
    expect(res.statusCode).toBe(429);
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
    const { rows } = await t.c.db.query<{ user_id: string }>(`SELECT user_id FROM platform.rate_counters`);
    expect(rows.map((r) => r.user_id)).toContain(u.userId);
    await t.app.inject({ url: "/v1/config", remoteAddress: "10.9.9.9" });
    const cols = await t.c.db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'platform' AND table_name = 'rate_counters'`);
    expect(cols.rows.map((r) => r.column_name).sort()).toEqual(["all_count", "user_id", "win", "write_count"]);
  });
});
