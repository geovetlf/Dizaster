import { ageAt } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, type TestContext } from "./helpers.js";

let t: TestContext;
beforeAll(async () => { t = await createTestContext(); });
afterAll(async () => { await t.close(); });

async function freshUser(handle: string) {
  const u = (await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle, platform: "ANDROID" } })).json() as { token: string; userId: string };
  return { ...u, auth: { authorization: `Bearer ${u.token}` } };
}

describe("edad mínima (D-13, ADR 0049)", () => {
  it("cuenta la edad con año y mes, de forma conservadora", () => {
    const now = new Date(Date.UTC(2026, 8, 29)); // septiembre de 2026
    expect(ageAt(2010, 8, now)).toBe(16); // cumplió en agosto
    expect(ageAt(2010, 9, now)).toBe(15); // cumple este mes: aún no cuenta
    expect(ageAt(2010, 10, now)).toBe(15);
  });

  it("sin declarar la edad se puede leer y configurar, pero no publicar", async () => {
    const u = await freshUser("edad_sin");
    expect((await t.app.inject({ url: "/v1/me/account", headers: u.auth })).json()).toMatchObject({ ageConfirmed: false, minAge: 16 });
    const post = await t.app.inject({ method: "POST", url: "/v1/posts", headers: u.auth, payload: { text: "hola" } });
    expect(post.statusCode).toBe(403);
    expect(post.json().error).toBe("AGE_CONFIRMATION_REQUIRED");
    expect((await t.app.inject({ method: "PUT", url: "/v1/me/alert-preferences", headers: u.auth, payload: { minSeverity: 3 } })).statusCode).toBeLessThan(300);
  });

  it("por debajo del mínimo no guarda nada; con la edad, habilita publicar", async () => {
    const u = await freshUser("edad_con");
    const young = await t.app.inject({ method: "POST", url: "/v1/me/age", headers: u.auth, payload: { birthYear: new Date().getUTCFullYear() - 14, birthMonth: 1 } });
    expect(young.statusCode).toBe(403);
    expect(young.json().error).toBe("UNDER_MIN_AGE");
    const { rows } = await t.c.db.query(`SELECT age_confirmed_at, age_confirmed_min FROM identity.users WHERE id = $1`, [u.userId]);
    expect(rows[0]).toEqual({ age_confirmed_at: null, age_confirmed_min: null });
    const ok = await t.app.inject({ method: "POST", url: "/v1/me/age", headers: u.auth, payload: { birthYear: 1990, birthMonth: 3, country: "PE" } });
    expect(ok.json()).toEqual({ ok: true, minAge: 16 });
    expect((await t.app.inject({ method: "POST", url: "/v1/posts", headers: u.auth, payload: { text: "hola" } })).statusCode).toBe(201);
    const stored = await t.c.db.query(`SELECT * FROM identity.users WHERE id = $1`, [u.userId]);
    expect(JSON.stringify(stored.rows[0])).not.toContain("1990");
  });
});
