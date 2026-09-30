import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, type TestContext } from "./helpers.js";

describe("borrar la cuenta de alguien del personal (ADR 0235)", () => {
  let t: TestContext;
  beforeAll(async () => { t = await createTestContext(); });
  afterAll(async () => { await t.close(); });

  const del = (token: string) => t.app.inject({ method: "DELETE", url: "/v1/me", headers: { authorization: `Bearer ${token}` }, payload: { confirm: "DELETE" } });

  it("el último administrador no puede borrar su cuenta; con otro administrador sí, y la baja queda registrada", async () => {
    const a = await createUser(t, "admin_unico");
    await t.c.identity.grantRole(a.userId, "admin");
    await t.c.identity.grantRole(a.userId, "moderator");
    const blocked = await del(a.token);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error).toBe("LAST_ADMIN");
    const { rows: still } = await t.c.db.query(`SELECT status FROM identity.users WHERE id = $1`, [a.userId]);
    expect(still[0].status).toBe("ACTIVE");

    const b = await createUser(t, "admin_segundo");
    await t.c.identity.grantRole(b.userId, "admin");
    expect((await del(a.token)).statusCode).toBeLessThan(300);
    const { rows } = await t.c.db.query<{ role: string; action: string; reason: string }>(
      `SELECT role, action, reason FROM identity.role_changes WHERE user_id = $1 AND action = 'REVOKE' ORDER BY role`, [a.userId],
    );
    expect(rows).toEqual([
      { role: "admin", action: "REVOKE", reason: "Cuenta borrada" },
      { role: "moderator", action: "REVOKE", reason: "Cuenta borrada" },
    ]);
  });

  it("una cuenta sin roles de personal se borra sin registro de roles", async () => {
    const u = await createUser(t, "sin_roles");
    expect((await del(u.token)).statusCode).toBeLessThan(300);
    const { rowCount } = await t.c.db.query(`SELECT 1 FROM identity.role_changes WHERE user_id = $1`, [u.userId]);
    expect(rowCount).toBe(0);
  });
});
