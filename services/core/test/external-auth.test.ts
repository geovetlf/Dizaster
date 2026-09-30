import type { AppConfig } from "@dizaster/contracts";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EmailSender } from "../src/platform/email.js";
import { createTestContext, type TestContext } from "./helpers.js";

// Apple, Google y correo con código (ADR 0170). Claves y correo locales: la prueba no sale a la red.
let t: TestContext;
const sent: { to: string; text: string }[] = [];
const email: EmailSender = { id: "test", send: async (m) => { sent.push(m); } };
type PrivKey = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
let applePriv: PrivKey;
let otherPriv: PrivKey;
const lastCode = () => /(\d{6})/.exec(sent.at(-1)!.text)![1]!;

beforeAll(async () => {
  const apple = await generateKeyPair("RS256", { extractable: true });
  const other = await generateKeyPair("RS256", { extractable: true });
  applePriv = apple.privateKey;
  otherPriv = other.privateKey;
  const jwk: JWK = { ...(await exportJWK(apple.publicKey)), kid: "k1", alg: "RS256" };
  t = await createTestContext({
    env: { AUTH_APPLE_AUDIENCES: "app.dizaster.ios" },
    overrides: { email, oidcKeys: { apple: createLocalJWKSet({ keys: [jwk] }) } },
  });
});
afterAll(() => t.close());

const appleToken = (claims: Record<string, unknown>, key: PrivKey = applePriv, aud = "app.dizaster.ios") =>
  new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer("https://appleid.apple.com").setAudience(aud)
    .setSubject(String(claims["sub"] ?? "apple-user-1")).setIssuedAt().setExpirationTime("5m").sign(key);

describe("inicio de sesión real", () => {
  it("la config anuncia solo lo configurado", async () => {
    const cfg = (await t.app.inject({ url: "/v1/config" })).json() as AppConfig;
    expect(cfg.authProviders).toEqual({ apple: true, google: false, email: true });
    const g = await t.app.inject({ method: "POST", url: "/v1/auth/google", payload: { idToken: await appleToken({}) } });
    expect(g.statusCode).toBe(503);
  });

  it("Apple: firma, emisor y audiencia; la misma persona vuelve a la misma cuenta", async () => {
    const ok = await t.app.inject({ method: "POST", url: "/v1/auth/apple", payload: { idToken: await appleToken({ sub: "apple-1" }), platform: "IOS" } });
    expect(ok.statusCode, ok.body).toBe(200);
    const again = await t.app.inject({ method: "POST", url: "/v1/auth/apple", payload: { idToken: await appleToken({ sub: "apple-1" }) } });
    expect(again.json().userId).toBe(ok.json().userId);
    expect(ok.json().deviceId).toBeTruthy();
    for (const bad of [await appleToken({ sub: "x" }, otherPriv), await appleToken({ sub: "x" }, applePriv, "otra.app"), "not.a.jwt.token.at.all"]) {
      expect((await t.app.inject({ method: "POST", url: "/v1/auth/apple", payload: { idToken: bad } })).statusCode).toBe(401);
    }
  });

  it("correo: código de 6 dígitos, 5 intentos, un solo uso, sin guardar el correo", async () => {
    const start = () => t.app.inject({ method: "POST", url: "/v1/auth/email/start", payload: { email: "Ana@Correo.pe " } });
    expect((await start()).statusCode).toBe(204);
    const code = lastCode();
    const verify = (c: string, mail = "ana@correo.pe") => t.app.inject({ method: "POST", url: "/v1/auth/email/verify", payload: { email: mail, code: c, platform: "ANDROID" } });
    const wrong = code === "000000" ? "111111" : "000000";
    expect((await verify(wrong)).statusCode).toBe(401);
    const ok = await verify(code);
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await verify(code)).statusCode).toBe(401);
    const stored = await t.c.db.query(`SELECT subject FROM identity.auth_identities WHERE provider = 'EMAIL'`);
    expect(JSON.stringify(stored.rows)).not.toContain("correo");
    const dump = await t.c.db.query(`SELECT * FROM identity.email_challenges`);
    expect(JSON.stringify(dump.rows)).not.toMatch(/correo|ana@/i);

    // Cinco intentos fallidos agotan el código aunque después llegue el correcto.
    await start();
    const c2 = lastCode();
    const w2 = c2 === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) await verify(w2);
    expect((await verify(c2)).statusCode).toBe(401);

    // Vincular Apple a la cuenta del correo.
    const token = ok.json().token as string;
    const link = await t.app.inject({ method: "POST", url: "/v1/me/identities", headers: { authorization: `Bearer ${token}` }, payload: { provider: "APPLE", idToken: await appleToken({ sub: "apple-2" }) } });
    expect(link.statusCode, link.body).toBe(204);
    const viaApple = await t.app.inject({ method: "POST", url: "/v1/auth/apple", payload: { idToken: await appleToken({ sub: "apple-2" }) } });
    expect(viaApple.json().userId).toBe(ok.json().userId);
    const ids = await t.app.inject({ url: "/v1/me/identities", headers: { authorization: `Bearer ${token}` } });
    expect(ids.json()).toEqual({ providers: ["APPLE", "EMAIL"] });
    // Una identidad de otra cuenta no se mueve.
    const taken = await t.app.inject({ method: "POST", url: "/v1/me/identities", headers: { authorization: `Bearer ${token}` }, payload: { provider: "APPLE", idToken: await appleToken({ sub: "apple-1" }) } });
    expect(taken.statusCode).toBe(409);
  });

  it("límite de códigos por correo", async () => {
    let last = 0;
    for (let i = 0; i < 6; i++) last = (await t.app.inject({ method: "POST", url: "/v1/auth/email/start", payload: { email: "limite@correo.pe" } })).statusCode;
    expect(last).toBe(429);
  });
});
