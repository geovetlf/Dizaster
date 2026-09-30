import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TIER_WEIGHT } from "../src/modules/trust/index.js";
import { confirmAge, createTestContext, type TestContext, type TestUser } from "./helpers.js";

// La reputación del teléfono ajusta el peso de la evidencia (§8.2, ADR 0180). NO AI REQUIRED.
let t: TestContext;
beforeAll(async () => { t = await createTestContext(); });
afterAll(() => t.close());

async function onPhone(handle: string, hardwareId: string): Promise<TestUser> {
  const u = (await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle, platform: "ANDROID", hardwareId } })).json() as TestUser;
  await confirmAge(t, u);
  // Cuenta con historial suficiente para no ser "nueva".
  await t.c.db.query(`UPDATE identity.users SET created_at = now() - interval '60 days' WHERE id = $1`, [u.userId]);
  return u;
}

describe("peso por teléfono", () => {
  it("una cuenta suspendida en el mismo teléfono baja el peso de las demás cuentas de ese teléfono; otro teléfono no cambia", async () => {
    const hw = "hw-phone-weight-000000000000000001";
    const a = await onPhone("pw_a", hw);
    const other = await onPhone("pw_other", "hw-phone-weight-000000000000000002");
    const eventId = "01928c1e-7b1a-7cc0-8a9e-2c4f5d6e7f00";
    const devices = new Map([[a.userId, [a.deviceId]], [other.userId, [other.deviceId]]]);
    const before = await t.c.trust.contributionWeights(t.c.db, [a.userId, other.userId], eventId, devices);
    expect(before.get(a.userId)).toBeGreaterThan(TIER_WEIGHT.LOW);

    const b = await onPhone("pw_b", hw);
    await t.c.db.query(`UPDATE identity.users SET status = 'SUSPENDED' WHERE id = $1`, [b.userId]);
    const after = await t.c.trust.contributionWeights(t.c.db, [a.userId, other.userId], eventId, devices);
    expect(after.get(a.userId)).toBe(TIER_WEIGHT.LOW);
    expect(after.get(other.userId)).toBe(before.get(other.userId));
    // Sin dispositivos conocidos no hay señal de teléfono: pesa por su cuenta.
    expect((await t.c.trust.contributionWeights(t.c.db, [a.userId], eventId)).get(a.userId)).toBe(before.get(a.userId));
  });
});
