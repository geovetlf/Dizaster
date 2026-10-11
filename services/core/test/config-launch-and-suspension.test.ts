import { readFileSync } from "node:fs";
import { AppConfig } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, type TestContext, type TestUser } from "./helpers.js";

/**
 * ADR 0340: el 403 ACCOUNT_SUSPENDED lleva el fin de la suspensión de la propia cuenta.
 * ADR 0341: /v1/config publica el estado de lanzamiento por país, leído de data/countries.
 */
let t: TestContext;
const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });
const COMMENT_URL = "/v1/posts/00000000-0000-4000-8000-000000000000/comments";
const write = (u: TestUser) =>
  t.app.inject({ method: "POST", url: COMMENT_URL, headers: auth(u), payload: { text: "Un comentario" } });

beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

describe("403 ACCOUNT_SUSPENDED con fin de la suspensión", () => {
  it("una suspensión con plazo devuelve suspendedUntil en ISO; solo `error`, `message` y ese campo", async () => {
    const u = await createUser(t, "susp_until_plazo");
    const until = new Date(Date.now() + 7 * 24 * 3_600_000);
    await t.c.identity.setUserStatus(t.c.db, u.userId, "SUSPENDED", until);
    const r = await write(u);
    expect(r.statusCode).toBe(403);
    const body = r.json() as Record<string, unknown>;
    expect(body.error).toBe("ACCOUNT_SUSPENDED");
    expect(typeof body.message).toBe("string");
    expect(Date.parse(body.suspendedUntil as string)).toBe(until.getTime());
    expect(Object.keys(body).sort()).toEqual(["error", "message", "suspendedUntil"]);
  });

  it("una suspensión permanente devuelve suspendedUntil null", async () => {
    const u = await createUser(t, "susp_until_perm");
    await t.c.identity.setUserStatus(t.c.db, u.userId, "SUSPENDED", null);
    const body = (await write(u)).json() as Record<string, unknown>;
    expect(body.error).toBe("ACCOUNT_SUSPENDED");
    expect(body).toHaveProperty("suspendedUntil", null);
  });

  it("los demás errores no ganan campos nuevos", async () => {
    const r = await t.app.inject({ method: "POST", url: COMMENT_URL, payload: { text: "Un comentario" } });
    expect(r.statusCode).toBe(401);
    expect(Object.keys(r.json() as object).sort()).toEqual(["error", "message"]);
  });

});

describe("/v1/config publica el estado de lanzamiento por país", () => {
  it("coincide con data/countries/country-config.json y con la regla del servidor", async () => {
    const r = await t.app.inject({ url: "/v1/config" });
    expect(r.statusCode).toBe(200);
    const cfg = AppConfig.parse(r.json());
    const file = JSON.parse(readFileSync(new URL("../../../data/countries/country-config.json", import.meta.url), "utf8")) as {
      version: string; defaults: { launchStatus: string }; countries: Array<{ iso2: string; launchStatus: string }>;
    };
    expect(cfg.launch).toBeDefined();
    const launch = cfg.launch!;
    expect(launch.version).toBe(file.version);
    expect(launch.defaults.launchStatus).toBe(file.defaults.launchStatus);
    expect(launch.defaults.acceptsCitizenReports).toBe(t.c.ref.acceptsCitizenReports(null));
    expect(launch.countries.map((c) => c.iso2).sort()).toEqual(file.countries.map((c) => c.iso2).sort());
    for (const c of launch.countries) {
      expect(c.launchStatus).toBe(t.c.ref.launchStatus(c.iso2));
      expect(c.acceptsCitizenReports).toBe(t.c.ref.acceptsCitizenReports(c.iso2));
      // Solo código, estado y si acepta reportes: ni notas internas ni otros campos del archivo.
      expect(Object.keys(c).sort()).toEqual(["acceptsCitizenReports", "iso2", "launchStatus"]);
    }
  });
});
