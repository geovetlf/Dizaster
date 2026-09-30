import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crashFingerprint } from "../src/platform/client-crashes.js";
import { createTestContext, createUser, type TestContext } from "./helpers.js";

describe("fallos de la app autoalojados (ADR 0173)", () => {
  let t: TestContext;
  beforeAll(async () => { t = await createTestContext(); });
  afterAll(async () => { await t.close(); });

  const entry = (message: string, stack: string | null, extra: object = {}) => ({ at: new Date().toISOString(), message, where: "global", stack, ...extra });

  it("agrupa por huella sin fijarse en números de línea", () => {
    expect(crashFingerprint("TypeError: x", "at foo (app.js:10:5)")).toBe(crashFingerprint("TypeError: x", "at foo (app.js:99:1)"));
    expect(crashFingerprint("TypeError: x", "at foo")).not.toBe(crashFingerprint("TypeError: y", "at foo"));
  });

  it("recibe sin sesión, no guarda cuenta ni IP, y administración ve los grupos", async () => {
    const res = await t.app.inject({
      method: "POST", url: "/v1/client-crashes", headers: { "x-app-platform": "android", "x-app-version": "1.2.0" },
      payload: { entries: [
        entry("TypeError: a is undefined", "at render (index.bundle:120:4)", { requestId: "0192aa00-1111-7000-8000-000000000abc" }),
        entry("TypeError: a is undefined", "at render (index.bundle:130:9)"),
        entry("Error: otro", null),
      ] },
    });
    expect(res.statusCode).toBe(204);
    const cols = await t.c.db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'platform' AND table_name = 'client_crashes'`);
    expect(cols.rows.map((r) => r.column_name)).not.toEqual(expect.arrayContaining(["user_id"]));
    expect(cols.rows.map((r) => r.column_name).some((c) => /ip|user/.test(c))).toBe(false);

    // Plataforma o versión raras se descartan; entradas no válidas se rechazan enteras.
    await t.app.inject({ method: "POST", url: "/v1/client-crashes", headers: { "x-app-platform": "web", "x-app-version": "<x>" }, payload: { entries: [entry("Error: otro", null)] } });
    expect((await t.app.inject({ method: "POST", url: "/v1/client-crashes", payload: { entries: [] } })).statusCode).toBe(400);
    expect((await t.app.inject({ method: "POST", url: "/v1/client-crashes", payload: { entries: [entry("x", null, { requestId: "<bad>" })] } })).statusCode).toBe(400);

    const u = await createUser(t, "crashuser");
    expect((await t.app.inject({ method: "GET", url: "/v1/admin/client-crashes", headers: { authorization: `Bearer ${u.token}` } })).statusCode).toBe(403);
    const summary = await t.c.crashes.summary(7);
    expect(summary.total).toBe(4);
    expect(summary.groups.find((g) => g.message.startsWith("TypeError"))).toMatchObject({
      message: "TypeError: a is undefined", count: 2, platforms: ["android"], appVersions: ["1.2.0"], lastRequestId: "0192aa00-1111-7000-8000-000000000abc",
    });
    expect(summary.groups.find((g) => g.message === "Error: otro")).toMatchObject({ count: 2, platforms: ["android"], appVersions: ["1.2.0"] });
  });

  it("la retención borra lo viejo", async () => {
    await t.c.db.query(`UPDATE platform.client_crashes SET received_at = now() - interval '40 days' WHERE message = 'Error: otro'`);
    expect(await t.c.crashes.applyRetention(30)).toBe(2);
    expect((await t.c.crashes.summary(30)).total).toBe(2);
  });
});
