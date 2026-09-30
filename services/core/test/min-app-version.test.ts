import { compareAppVersions, isBelowMinVersion, type AppConfig } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, LIMA, reportBody, type TestContext } from "./helpers.js";

// Versión mínima de la app por plataforma (ADR 0164). NO AI REQUIRED.
let t: TestContext;
beforeAll(async () => {
  t = await createTestContext({ env: { MIN_APP_VERSION_ANDROID: "1.4.0", STORE_URL_ANDROID: "https://play.google.com/store/apps/details?id=app.dizaster" } });
});
afterAll(() => t.close());

describe("comparación de versiones", () => {
  it("numérica por partes, y nunca bloquea por falta de datos", () => {
    expect(compareAppVersions("1.10.0", "1.9.9")).toBe(1);
    expect(compareAppVersions("1.4", "1.4.0")).toBe(0);
    expect(compareAppVersions("1.3.9", "1.4.0")).toBe(-1);
    expect(isBelowMinVersion("1.3.9", "1.4.0")).toBe(true);
    expect(isBelowMinVersion("1.4.0", "1.4.0")).toBe(false);
    expect(isBelowMinVersion(null, "1.4.0")).toBe(false);
    expect(isBelowMinVersion("1.0.0", null)).toBe(false);
  });
});

describe("versión mínima en /v1/config y al escribir", () => {
  it("la config la anuncia por plataforma", async () => {
    const cfg = (await t.app.inject({ url: "/v1/config" })).json() as AppConfig;
    expect(cfg.appUpdate).toEqual({
      android: { minVersion: "1.4.0", storeUrl: "https://play.google.com/store/apps/details?id=app.dizaster" },
      ios: { minVersion: null, storeUrl: null },
    });
  });

  it("una app vieja no envía reportes (426); sin cabeceras, otra plataforma o al día, sí", async () => {
    const u = await createUser(t, "version_vieja");
    const send = (headers: Record<string, string>) =>
      t.app.inject({ method: "POST", url: "/v1/reports", headers: { authorization: `Bearer ${u.token}`, ...headers }, payload: reportBody(u, { category: "fire.structure", pin: LIMA }) });
    const old = await send({ "x-app-platform": "android", "x-app-version": "1.3.2" });
    expect(old.statusCode).toBe(426);
    expect(old.json()).toMatchObject({ error: "APP_UPDATE_REQUIRED" });
    expect((await send({ "x-app-platform": "ios", "x-app-version": "1.0.0" })).statusCode).toBe(200);
    expect((await send({ "x-app-platform": "android", "x-app-version": "1.4.1" })).statusCode).toBe(200);
    expect((await send({})).statusCode).toBe(200);
    // Emergencias y lectura nunca dependen de la versión.
    expect((await t.app.inject({ url: "/v1/reference/emergency-numbers", headers: { "x-app-platform": "android", "x-app-version": "0.1.0" } })).statusCode).toBe(200);
  });
});
