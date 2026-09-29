import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, type TestContext, type TestUser } from "./helpers.js";

let t: TestContext;
beforeAll(async () => { t = await createTestContext(); });
afterAll(async () => { await t.close(); });

const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });
const patch = (u: TestUser | null, payload: unknown) =>
  t.app.inject({ method: "PATCH", url: "/v1/me", ...(u ? { headers: auth(u) } : {}), payload: payload as Record<string, unknown> });

describe("editar mi perfil (ADR 0044)", () => {
  it("cambia nombre, bio y unidades; la bio es pública y las unidades no", async () => {
    const u = await createUser(t, "perfil_editable");
    const res = await patch(u, { displayName: "  Ana Rescate  ", bio: "Bombera voluntaria en Lima", units: "imperial" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ displayName: "Ana Rescate", bio: "Bombera voluntaria en Lima", units: "imperial", isMe: true });
    const pub = (await t.app.inject({ url: `/v1/profiles/${res.json().handle}` })).json();
    expect(pub).toMatchObject({ displayName: "Ana Rescate", bio: "Bombera voluntaria en Lima" });
    expect(pub.units).toBeUndefined();
    expect((await patch(u, { bio: "" })).json().bio).toBeNull();
  });

  it("valida la entrada y exige sesión", async () => {
    const u = await createUser(t, "perfil_invalido");
    expect((await patch(u, {})).statusCode).toBe(400);
    expect((await patch(u, { displayName: "" })).statusCode).toBe(400);
    expect((await patch(u, { bio: "x".repeat(161) })).statusCode).toBe(400);
    expect((await patch(u, { units: "parsecs" })).statusCode).toBe(400);
    expect((await patch(null, { bio: "hola" })).statusCode).toBe(401);
  });

  it("país preferido (ADR 0085): privado, validado y se puede quitar", async () => {
    const u = await createUser(t, "perfil_pais");
    expect((await t.app.inject({ url: "/v1/me", headers: auth(u) })).json().country).toBeNull();
    const res = await patch(u, { country: "PE" });
    expect(res.statusCode).toBe(200);
    expect(res.json().country).toBe("PE");
    const pub = (await t.app.inject({ url: `/v1/profiles/${res.json().handle}` })).json();
    expect(pub.country).toBeUndefined();
    expect((await patch(u, { country: "ZZ" })).statusCode).toBe(400);
    expect((await patch(u, { country: "pe" })).statusCode).toBe(400);
    expect((await t.app.inject({ url: "/v1/me", headers: auth(u) })).json().country).toBe("PE");
    expect((await patch(u, { country: null })).json().country).toBeNull();
  });
});
