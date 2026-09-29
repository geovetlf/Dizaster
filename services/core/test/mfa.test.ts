import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { base32Decode, base32Encode, hotp, matchTotp, totpStep, MFA_MAX_FAILURES } from "../src/modules/identity/mfa.js";
import { loadEnv } from "../src/platform/config.js";
import { createTestContext, createUser, type TestContext, type TestUser } from "./helpers.js";

// MFA TOTP para moderación y administración (ADR 0090, Blueprint §13.1). NO AI REQUIRED.
describe("TOTP (RFC 6238)", () => {
  it("vectores del RFC 6238 (SHA-1) y base32 ida y vuelta", () => {
    const secret = Buffer.from("12345678901234567890");
    // RFC 6238, apéndice B: T=59 → 94287082 (8 dígitos); con 6 dígitos, 287082.
    expect(hotp(secret, totpStep(new Date(59_000)), 8)).toBe("94287082");
    expect(hotp(secret, totpStep(new Date(1111111109_000)), 8)).toBe("07081804");
    expect(hotp(secret, totpStep(new Date(59_000)))).toBe("287082");
    expect(base32Decode(base32Encode(secret)).equals(secret)).toBe(true);
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
  });
  it("acepta ±1 paso y rechaza el resto", () => {
    const secret = Buffer.from("12345678901234567890");
    const at = new Date(1_700_000_000_000);
    const step = totpStep(at);
    expect(matchTotp(secret, hotp(secret, step - 1), at)).toBe(step - 1);
    expect(matchTotp(secret, hotp(secret, step + 2), at)).toBeNull();
    expect(matchTotp(secret, "12345", at)).toBeNull();
  });
  it("producción no admite apagarla", () => {
    expect(() => loadEnv({
      NODE_ENV: "production", DATABASE_URL: "postgres://x", AUTH_JWT_SECRET: "x".repeat(40), STAFF_MFA_REQUIRED: "false",
      FIELD_KEYS: "k", STORAGE_DRIVER: "s3", S3_ENDPOINT: "https://s3", S3_BUCKET: "b", S3_ACCESS_KEY_ID: "a", S3_SECRET_ACCESS_KEY: "s", PUSH_DRIVER: "live",
    })).toThrow(/MFA/);
  });
});

let t: TestContext;
let mod: TestUser;
beforeAll(async () => {
  t = await createTestContext({ env: { STAFF_MFA_REQUIRED: "true" } });
  mod = await createUser(t, "mfa_mod");
  await t.c.identity.grantRole(mod.userId, "moderator");
  mod = { ...mod, token: (await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle: "mfa_mod", platform: "ANDROID", deviceId: mod.deviceId } })).json().token };
});
afterAll(async () => { await t.close(); });

const auth = (u: TestUser, token = u.token) => ({ authorization: `Bearer ${token}` });
const code = (b32: string, offsetSteps = 0) => hotp(base32Decode(b32), totpStep(new Date()) + offsetSteps);

describe("MFA del personal", () => {
  let secret = "";

  it("sin autenticador, moderación responde que hay que activarlo; una persona sin rol no puede usar MFA", async () => {
    const res = await t.app.inject({ url: "/v1/moderation/cases", headers: auth(mod) });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("MFA_ENROLLMENT_REQUIRED");
    const normal = await createUser(t, "mfa_normal");
    expect((await t.app.inject({ url: "/v1/me/mfa", headers: auth(normal) })).statusCode).toBe(403);
    expect((await t.app.inject({ url: "/v1/me/mfa", headers: auth(mod) })).json()).toEqual({ enrolled: false, required: true, recoveryCodesLeft: 0 });
  });

  it("alta: secreto + otpauth, confirmación con código y códigos de recuperación; la sesión queda verificada", async () => {
    const e = (await t.app.inject({ method: "POST", url: "/v1/me/mfa/totp", headers: auth(mod) })).json();
    expect(e.otpauthUri).toMatch(/^otpauth:\/\/totp\/Dizaster%3Amfa_mod\w*\?secret=[A-Z2-7]+&issuer=Dizaster/);
    secret = e.secret;
    const stored = (await t.c.db.query<{ secret_enc: string }>(`SELECT secret_enc FROM identity.mfa_totp WHERE user_id = $1`, [mod.userId])).rows[0]!;
    expect(stored.secret_enc).not.toContain(secret);
    expect((await t.app.inject({ method: "POST", url: "/v1/me/mfa/totp/confirm", headers: auth(mod), payload: { code: "000000" } })).statusCode).toBe(400);
    const ok = await t.app.inject({ method: "POST", url: "/v1/me/mfa/totp/confirm", headers: auth(mod), payload: { code: code(secret) } });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().recoveryCodes).toHaveLength(8);
    expect((await t.app.inject({ url: "/v1/moderation/cases", headers: auth(mod) })).statusCode).toBe(200);
    expect((await t.app.inject({ method: "POST", url: "/v1/me/mfa/totp", headers: auth(mod) })).statusCode).toBe(409);
    (globalThis as { recovery?: string[] }).recovery = ok.json().recoveryCodes;
  });

  it("otra sesión debe verificar; un código no se reutiliza; los de recuperación sirven una vez", async () => {
    const other = (await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle: "mfa_mod", platform: "ANDROID", deviceId: mod.deviceId } })).json().token;
    const r = await t.app.inject({ url: "/v1/moderation/cases", headers: auth(mod, other) });
    expect(r.json().error).toBe("MFA_REQUIRED");
    // El código del paso ya usado en la confirmación no vale otra vez.
    expect((await t.app.inject({ method: "POST", url: "/v1/me/mfa/verify", headers: auth(mod, other), payload: { code: code(secret) } })).statusCode).toBe(400);
    const recovery = (globalThis as { recovery?: string[] }).recovery!;
    const v = await t.app.inject({ method: "POST", url: "/v1/me/mfa/verify", headers: auth(mod, other), payload: { recoveryCode: recovery[0] } });
    expect(v.statusCode, v.body).toBe(200);
    expect((await t.app.inject({ url: "/v1/moderation/cases", headers: auth(mod, other) })).statusCode).toBe(200);
    const third = (await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle: "mfa_mod", platform: "ANDROID", deviceId: mod.deviceId } })).json().token;
    expect((await t.app.inject({ method: "POST", url: "/v1/me/mfa/verify", headers: auth(mod, third), payload: { recoveryCode: recovery[0] } })).statusCode).toBe(400);
    expect((await t.app.inject({ method: "POST", url: "/v1/me/mfa/verify", headers: auth(mod, third), payload: { code: code(secret, 1) } })).statusCode).toBe(200);
    expect((await t.app.inject({ url: "/v1/me/mfa", headers: auth(mod) })).json().recoveryCodesLeft).toBe(7);
  });

  it("tras varios códigos incorrectos se bloquea un rato", async () => {
    const tok = (await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle: "mfa_mod", platform: "ANDROID", deviceId: mod.deviceId } })).json().token;
    const statuses: number[] = [];
    for (let i = 0; i < MFA_MAX_FAILURES; i++) {
      statuses.push((await t.app.inject({ method: "POST", url: "/v1/me/mfa/verify", headers: auth(mod, tok), payload: { code: "999999" } })).statusCode);
    }
    expect(statuses.every((s) => s === 400 || s === 429)).toBe(true);
    expect((await t.app.inject({ method: "POST", url: "/v1/me/mfa/verify", headers: auth(mod, tok), payload: { code: "999999" } })).statusCode).toBe(429);
  });
});
