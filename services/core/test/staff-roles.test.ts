import type { StaffResponse, RoleChangesResponse } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, type TestContext, type TestUser } from "./helpers.js";

// Roles de personal: altas y bajas auditadas (ADR 0167). NO AI REQUIRED.
let t: TestContext;
const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });
async function signIn(u: TestUser, handle: string): Promise<TestUser> {
  const token = (await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle, platform: "ANDROID", deviceId: u.deviceId } })).json().token as string;
  return { ...u, token };
}

beforeAll(async () => { t = await createTestContext(); });
afterAll(() => t.close());

describe("roles de personal", () => {
  it("administración da y quita roles con motivo; quitar corta el acceso al momento", async () => {
    const a = await createUser(t, "admin_roles");
    await t.c.identity.grantRole(a.userId, "admin");
    const admin = await signIn(a, "admin_roles");
    const o = await createUser(t, "operador_roles");
    const oh = await t.c.social.handleById(t.c.db, o.profileId);
    const ah = await t.c.social.handleById(t.c.db, a.profileId);

    const change = (by: TestUser, body: object) => t.app.inject({ method: "POST", url: "/v1/admin/staff/roles", headers: auth(by), payload: body });
    expect((await change(admin, { handle: oh, role: "operator", action: "GRANT", reason: "Turno de noche" })).statusCode).toBe(204);
    const op = await signIn(o, "operador_roles");
    expect((await t.app.inject({ url: "/v1/admin/sources", headers: auth(op) })).statusCode).toBe(200);
    // Un operador no administra roles.
    expect((await change(op, { handle: oh, role: "admin", action: "GRANT", reason: "yo mismo" })).statusCode).toBe(403);

    expect((await change(admin, { handle: oh, role: "operator", action: "REVOKE", reason: "Dejó el equipo" })).statusCode).toBe(204);
    // Su token sigue vivo, pero el rol ya no vale y la sesión quedó cerrada.
    expect((await t.app.inject({ url: "/v1/admin/sources", headers: auth(op) })).statusCode).toBe(403);
    const open = await t.c.db.query(`SELECT 1 FROM identity.sessions WHERE user_id = $1 AND revoked_at IS NULL`, [o.userId]);
    expect(open.rowCount).toBe(0);
    expect((await change(admin, { handle: oh, role: "operator", action: "REVOKE", reason: "otra vez" })).statusCode).toBe(409);

    // Nunca sin administradores.
    const last = await change(admin, { handle: ah, role: "admin", action: "REVOKE", reason: "me voy" });
    expect(last.statusCode).toBe(409);
    expect(last.json()).toMatchObject({ error: "LAST_ADMIN" });

    const view = (await t.app.inject({ url: "/v1/admin/staff", headers: auth(admin) })).json() as StaffResponse;
    expect(view.staff).toEqual([{ handle: ah, roles: ["admin"] }]);
    expect(view.changes.slice(0, 2)).toMatchObject([
      { handle: oh, role: "operator", action: "REVOKE", reason: "Dejó el equipo" },
      { handle: oh, role: "operator", action: "GRANT", reason: "Turno de noche" },
    ]);
    // Historial completo por páginas (ADR 0296): sin repetir ni perder cambios.
    const total = (await t.c.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM identity.role_changes`)).rows[0]!.n;
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res = await t.app.inject({ url: `/v1/admin/staff/changes?limit=1${cursor ? `&cursor=${cursor}` : ""}`, headers: auth(admin) });
      expect(res.statusCode).toBe(200);
      const page = res.json() as RoleChangesResponse;
      seen.push(...page.changes.map((x) => `${x.at}|${x.role}|${x.action}|${x.reason}`));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(total);
    expect(new Set(seen).size).toBe(total);
    expect(view.changesNextCursor).toBeNull(); // menos de 50 cambios: todo en la primera vista
    expect((await t.app.inject({ url: "/v1/admin/staff/changes", headers: auth(o) })).statusCode).toBe(403);

    // El registro no se puede reescribir.
    await expect(t.c.db.query(`DELETE FROM identity.role_changes`)).rejects.toThrow(/solo se inserta/);
  });
});
