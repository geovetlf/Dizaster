import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, type TestContext, type TestUser } from "./helpers.js";

// La suspensión no quita la protección: los avisos de seguridad siguen funcionando (§13.3, ADR 0225).
let t: TestContext;
let u: TestUser;
const call = (method: "PUT" | "POST" | "DELETE", url: string, payload?: object) =>
  t.app.inject({ method, url, headers: { authorization: `Bearer ${u.token}` }, ...(payload ? { payload } : {}) });

beforeAll(async () => {
  t = await createTestContext();
  u = await createUser(t, "suspendida_avisos");
  await t.c.identity.setUserStatus(t.c.db, u.userId, "SUSPENDED");
});
afterAll(() => t.close());
const suspendedError = (r: { body: string }) => (r.body ? (JSON.parse(r.body) as { error?: string }).error : undefined);

describe("cuenta suspendida", () => {
  it("renueva su token push, preferencias, zonas y ubicación aproximada", async () => {
    expect(suspendedError(await call("PUT", `/v1/devices/${u.deviceId}/push-token`, { provider: "FCM", token: "t".repeat(40) }))).not.toBe("ACCOUNT_SUSPENDED");
    expect((await call("PUT", "/v1/me/alert-preferences", { nearMe: true })).statusCode).toBe(200);
    const zone = await call("POST", "/v1/me/zones", { name: "Casa", center: { lat: -12.12, lng: -77.03 }, radiusM: 2000 });
    expect(suspendedError(zone)).not.toBe("ACCOUNT_SUSPENDED");
    expect(suspendedError(await call("PUT", "/v1/me/approximate-location", { lat: -12.12, lng: -77.03 }))).not.toBe("ACCOUNT_SUSPENDED");
    expect(suspendedError(await call("POST", "/v1/me/notifications/read", {}))).not.toBe("ACCOUNT_SUSPENDED");
  });

  it("sigue sin poder publicar, comentar ni seguir personas", async () => {
    expect((await call("POST", "/v1/posts", { text: "hola" })).json().error).toBe("ACCOUNT_SUSPENDED");
    expect((await call("PUT", "/v1/follows/profile/alguien")).json().error).toBe("ACCOUNT_SUSPENDED");
  });
});
