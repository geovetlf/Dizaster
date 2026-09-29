import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, type TestContext } from "./helpers.js";

let t: TestContext;
beforeAll(async () => { t = await createTestContext(); });
afterAll(async () => { await t.close(); });

async function devSignIn(handle: string, platform: "IOS" | "ANDROID", deviceId?: string) {
  const res = await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle, platform, ...(deviceId ? { deviceId } : {}) } });
  expect(res.statusCode).toBe(200);
  return res.json() as { token: string; deviceId: string };
}

const putToken = (token: string, deviceId: string, payload: object) =>
  t.app.inject({ method: "PUT", url: `/v1/devices/${deviceId}/push-token`, headers: { authorization: `Bearer ${token}` }, payload });

const pushRow = async (id: string) =>
  (await t.c.db.query<{ push_token: string | null; push_provider: string | null; push_environment: string | null }>(
    `SELECT push_token, push_provider, push_environment FROM identity.devices WHERE id = $1`, [id],
  )).rows[0];

describe("Dispositivos iOS y Android con paridad", () => {
  it("reutiliza el dispositivo propio al volver a iniciar sesión, en ambas plataformas", async () => {
    for (const platform of ["IOS", "ANDROID"] as const) {
      const first = await devSignIn(`reuse_${platform}`, platform);
      const again = await devSignIn(`reuse_${platform}`, platform, first.deviceId);
      expect(again.deviceId).toBe(first.deviceId);
    }
  });

  it("no reutiliza un dispositivo ajeno ni de otra plataforma", async () => {
    const a = await devSignIn("owner_a", "IOS");
    const b = await devSignIn("owner_b", "IOS", a.deviceId);
    expect(b.deviceId).not.toBe(a.deviceId);
    const c = await devSignIn("owner_a", "ANDROID", a.deviceId);
    expect(c.deviceId).not.toBe(a.deviceId);
  });

  it("iOS registra token APNs con entorno y Android token FCM", async () => {
    const ios = await devSignIn("push_ios", "IOS");
    expect((await putToken(ios.token, ios.deviceId, { provider: "APNS", token: "a".repeat(64), environment: "development" })).statusCode).toBe(204);
    expect(await pushRow(ios.deviceId)).toEqual({ push_token: "a".repeat(64), push_provider: "APNS", push_environment: "development" });

    const android = await devSignIn("push_android", "ANDROID");
    expect((await putToken(android.token, android.deviceId, { provider: "FCM", token: "f".repeat(152) })).statusCode).toBe(204);
    expect(await pushRow(android.deviceId)).toMatchObject({ push_provider: "FCM", push_environment: "production" });
  });

  it("rechaza un proveedor que no corresponde a la plataforma", async () => {
    const ios = await devSignIn("mismatch_ios", "IOS");
    const res = await putToken(ios.token, ios.deviceId, { provider: "FCM", token: "x".repeat(64) });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("PUSH_PROVIDER_MISMATCH");
  });

  it("no permite registrar tokens en dispositivos ajenos", async () => {
    const a = await devSignIn("victim", "ANDROID");
    const b = await devSignIn("attacker", "ANDROID");
    expect((await putToken(b.token, a.deviceId, { provider: "FCM", token: "z".repeat(64) })).statusCode).toBe(404);
  });

  it("un token reaparecido en otro dispositivo se mueve y se puede borrar", async () => {
    const old = await devSignIn("reinstall", "ANDROID");
    await putToken(old.token, old.deviceId, { provider: "FCM", token: "r".repeat(64) });
    const fresh = await devSignIn("reinstall", "ANDROID");
    await putToken(fresh.token, fresh.deviceId, { provider: "FCM", token: "r".repeat(64) });
    expect((await pushRow(old.deviceId))?.push_token).toBeNull();
    expect((await pushRow(fresh.deviceId))?.push_token).toBe("r".repeat(64));

    const del = await t.app.inject({ method: "DELETE", url: `/v1/devices/${fresh.deviceId}/push-token`, headers: { authorization: `Bearer ${fresh.token}` } });
    expect(del.statusCode).toBe(204);
    expect((await pushRow(fresh.deviceId))?.push_token).toBeNull();
  });
});
