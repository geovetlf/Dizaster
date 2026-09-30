import { can, isStaff, PERMISSIONS, type StaffRole } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, type TestContext, type TestUser } from "./helpers.js";

let t: TestContext;
async function withRole(handle: string, role: StaffRole | null): Promise<TestUser> {
  const u = await createUser(t, handle);
  if (!role) return u;
  await t.c.identity.grantRole(u.userId, role);
  const token = (await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle, platform: "ANDROID", deviceId: u.deviceId } })).json().token as string;
  return { ...u, token };
}
const call = (u: TestUser, method: "GET" | "PUT" | "POST", url: string, payload?: Record<string, unknown>) =>
  t.app.inject({ method, url, headers: { authorization: `Bearer ${u.token}` }, ...(payload ? { payload } : {}) }).then((r) => r.statusCode);

beforeAll(async () => { t = await createTestContext(); });
afterAll(() => t.close());

describe("roles verificador y operador (ADR 0101)", () => {
  it("la tabla de permisos: mínimo privilegio", () => {
    expect(can(["user", "verifier"], "event.verify")).toBe(true);
    expect(can(["user", "verifier"], "content.moderate")).toBe(false);
    expect(can(["user", "operator"], "ops.view")).toBe(true);
    expect(can(["user", "operator"], "admin")).toBe(false);
    expect(can(["user", "moderator"], "ops.view")).toBe(false);
    for (const p of Object.keys(PERMISSIONS) as (keyof typeof PERMISSIONS)[]) expect(can(["admin"], p)).toBe(true);
    expect(isStaff(["user"])).toBe(false);
    expect(isStaff(["user", "operator"])).toBe(true);
  });

  it("cada rol solo llega a sus rutas", async () => {
    const [verifier, operator, moderator, user] = await Promise.all([
      withRole("rol_verif", "verifier"), withRole("rol_oper", "operator"), withRole("rol_mod", "moderator"), withRole("rol_user", null),
    ]);
    const matrix: [TestUser, number, number, number, number, number][] = [
      //              duplicados  casos  costo  kill switch  presupuesto
      [verifier, 200, 403, 403, 403, 403],
      [operator, 403, 403, 200, 200, 403],
      [moderator, 200, 200, 403, 403, 403],
      [user, 403, 403, 403, 403, 403],
    ];
    for (const [u, dup, cases, cost, kill, budget] of matrix) {
      expect(await call(u, "GET", "/v1/moderation/duplicates")).toBe(dup);
      expect(await call(u, "GET", "/v1/moderation/cases")).toBe(cases);
      expect(await call(u, "GET", "/v1/admin/cost")).toBe(cost);
      expect(await call(u, "PUT", "/v1/admin/kill-switches/video", { killed: false, reason: "Prueba de rol" })).toBe(kill);
      expect(await call(u, "PUT", "/v1/admin/cost/budgets/ai", { period: "MONTHLY", limitUsd: 0, reason: "Prueba de rol" })).toBe(budget);
    }
    // Todo el personal puede configurar su segundo factor; una persona sin rol, no.
    expect(await call(operator, "GET", "/v1/me/mfa")).toBe(200);
    expect(await call(verifier, "GET", "/v1/me/mfa")).toBe(200);
    expect(await call(user, "GET", "/v1/me/mfa")).toBe(403);
  });
});
