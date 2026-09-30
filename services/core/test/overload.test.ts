import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isOverloadError } from "../src/platform/db.js";
import { createTestContext, type TestContext } from "./helpers.js";

// Tiempos límite y descarga en picos (ADR 0201). NO AI REQUIRED.
let t: TestContext;
beforeAll(async () => { t = await createTestContext({ env: { DB_POOL_MAX: "2", DB_STATEMENT_TIMEOUT_MS: "1000", API_MAX_DB_WAITING: "1" } }); });
afterAll(async () => { await t.close(); });

describe("sobrecarga", () => {
  it("PostgreSQL corta una consulta que pasa del límite y se reconoce como sobrecarga", async () => {
    const err = await t.c.db.query("SELECT pg_sleep(3)").catch((e: unknown) => e);
    expect((err as { code?: string }).code).toBe("57014");
    expect(isOverloadError(err)).toBe(true);
    expect(isOverloadError(new Error("timeout exceeded when trying to connect"))).toBe(true);
    expect(isOverloadError(new Error("otra cosa"))).toBe(false);
  });

  it("con demasiadas peticiones esperando conexión responde 503 al instante con Retry-After; /health no se descarta", async () => {
    const held = await Promise.all([t.c.db.connect(), t.c.db.connect()]);
    const waiting = [t.c.db.query("SELECT 1"), t.c.db.query("SELECT 1")];
    try {
      expect(t.c.db.waitingCount).toBeGreaterThan(1);
      const r = await t.app.inject({ url: "/v1/config" });
      expect(r.statusCode).toBe(503);
      expect(r.json()).toMatchObject({ error: "OVERLOADED" });
      expect(r.headers["retry-after"]).toBe("5");
      const health = t.app.inject({ url: "/health" });
      for (const c of held) c.release();
      expect((await health).statusCode).toBe(200);
    } finally {
      await Promise.all(waiting);
    }
    expect((await t.app.inject({ url: "/v1/config" })).statusCode).toBe(200);
  });
});
