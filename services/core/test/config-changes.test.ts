import type { ConfigChangesResponse } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, type TestContext } from "./helpers.js";

// Historial de configuración de administración (§13.1, §13.3, ADR 0219). NO AI REQUIRED.
let t: TestContext;
let admin: string;
let adminHandle: string;
const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const put = (url: string, payload: object) => t.app.inject({ method: "PUT", url, headers: auth(admin), payload });
const history = async (query = "") => (await t.app.inject({ url: `/v1/admin/config-changes${query}`, headers: auth(admin) })).json() as ConfigChangesResponse;

beforeAll(async () => {
  t = await createTestContext();
  const a = await createUser(t, "admin_config");
  await t.c.identity.grantRole(a.userId, "admin");
  admin = (await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle: "admin_config", platform: "ANDROID", deviceId: a.deviceId } })).json().token as string;
  adminHandle = (await t.c.db.query<{ handle: string }>(`SELECT handle FROM social.profiles WHERE id = $1`, [a.profileId])).rows[0]!.handle;
});
afterAll(() => t.close());

describe("cambios de configuración con motivo e historial", () => {
  it("sin motivo no se cambia nada", async () => {
    expect((await put("/v1/admin/cost/budgets/ai", { period: "DAILY", limitUsd: 5 })).statusCode).toBe(400);
    expect((await put("/v1/admin/kill-switches/video", { killed: true, reason: "  " })).statusCode).toBe(400);
    expect((await put("/v1/admin/categories/crime.violence/publish-delay", { minutes: 10 })).statusCode).toBe(400);
    expect((await history()).changes).toEqual([]);
    expect((await t.c.cost.killSwitches()).find((k) => k.feature === "video")?.killed ?? false).toBe(false);
  });

  it("cada cambio queda con quién, antes, después y motivo; más reciente primero y paginado", async () => {
    expect((await put("/v1/admin/cost/budgets/ai", { period: "DAILY", limitUsd: 5, reason: "Piloto aprobado" })).statusCode).toBe(200);
    expect((await put("/v1/admin/cost/budgets/ai", { period: "DAILY", limitUsd: 8, reason: "Más tráfico en Lima" })).statusCode).toBe(200);
    expect((await put("/v1/admin/kill-switches/video", { killed: true, reason: "Costo de video alto" })).statusCode).toBe(200);
    expect((await put("/v1/admin/categories/crime.violence/publish-delay", { minutes: 10, reason: "Pedido de seguridad" })).statusCode).toBe(200);

    const all = await history();
    expect(all.changes.map((c) => c.kind)).toEqual(["PUBLISH_DELAY", "KILL_SWITCH", "BUDGET", "BUDGET"]);
    expect(all.changes[2]).toMatchObject({ actorHandle: adminHandle, target: "ai", previous: { period: "DAILY", limitUsd: 5 }, next: { limitUsd: 8 }, reason: "Más tráfico en Lima" });
    expect(all.changes[3]!.previous).toMatchObject({ limitUsd: 0 });
    expect(all.changes[0]).toMatchObject({ target: "crime.violence", previous: { minutes: 5 }, next: { minutes: 10 } });

    const page = await history("?limit=2");
    expect(page.changes).toHaveLength(2);
    const rest = await history(`?limit=2&cursor=${page.nextCursor}`);
    expect(rest.changes.map((c) => c.kind)).toEqual(["BUDGET", "BUDGET"]);
    expect(rest.nextCursor).toBeNull();
    expect((await history("?kind=KILL_SWITCH")).changes).toHaveLength(1);
  });

  it("el historial es de solo inserción y solo lo ve administración", async () => {
    await expect(t.c.db.query(`UPDATE platform.config_changes SET reason = 'otro'`)).rejects.toThrow(/solo se inserta/);
    await expect(t.c.db.query(`DELETE FROM platform.config_changes`)).rejects.toThrow(/solo se inserta/);
    const u = await createUser(t, "curioso_config");
    expect((await t.app.inject({ url: "/v1/admin/config-changes", headers: auth(u.token) })).statusCode).toBe(403);
  });

  it("si el registro falla, el cambio no se aplica (misma transacción, ADR 0238)", async () => {
    await t.c.db.query(`CREATE OR REPLACE FUNCTION platform.test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'registro caído'; END $$`);
    await t.c.db.query(`CREATE TRIGGER test_fail_audit BEFORE INSERT ON platform.config_changes FOR EACH ROW EXECUTE FUNCTION platform.test_fail_audit()`);
    try {
      const budgetBefore = (await t.c.cost.budgets(t.c.db)).find((b) => b.key === "ai");
      const killBefore = (await t.c.cost.killSwitches()).find((k) => k.feature === "photos")?.killed ?? false;
      expect((await put("/v1/admin/cost/budgets/ai", { period: "DAILY", limitUsd: 77, reason: "Prueba de atomicidad" })).statusCode).toBe(500);
      expect((await put("/v1/admin/kill-switches/photos", { killed: !killBefore, reason: "Prueba de atomicidad" })).statusCode).toBe(500);
      expect((await t.c.cost.budgets(t.c.db)).find((b) => b.key === "ai")).toEqual(budgetBefore);
      expect((await t.c.cost.killSwitches()).find((k) => k.feature === "photos")?.killed ?? false).toBe(killBefore);
    } finally {
      await t.c.db.query(`DROP TRIGGER test_fail_audit ON platform.config_changes`);
      await t.c.db.query(`DROP FUNCTION platform.test_fail_audit()`);
    }
  });
});
