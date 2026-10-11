import type { AppealView, CaseSummary, ModerationNotice } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, type TestContext, type TestUser } from "./helpers.js";

/**
 * Suspender o reactivar una cuenta de administración (ADR 0327, sobre ADR 0319): solo otra persona de administración.
 * Moderación no puede dejar fuera a un administrador ni deshacer la suspensión que decidió administración. Entre
 * personas moderadoras sigue como aprobó ADR 0319 (lo cubre suspension-durations.test.ts).
 */
let t: TestContext;
let mod: TestUser;
let admin: TestUser;
let admin2: TestUser;
let vecino: TestUser;
let n = 0;
const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });
const act = (u: TestUser, caseId: string, action: string, extra: object = {}) =>
  t.app.inject({ method: "POST", url: `/v1/moderation/cases/${caseId}/actions`, headers: auth(u), payload: { action, reason: "Amenazas reiteradas a otras personas", ...extra } });
const status = async (u: TestUser) => (await t.c.db.query<{ status: string }>(`SELECT status FROM identity.users WHERE id = $1`, [u.userId])).rows[0]!.status;
const suspensions = async (u: TestUser) => (await t.c.db.query<{ n: number }>(
  `SELECT count(*)::int AS n FROM moderation.actions WHERE affected_user_id = $1 AND action IN ('SUSPEND_USER','UNSUSPEND_USER')`, [u.userId])).rows[0]!.n;

async function withRole(handle: string, role: "moderator" | "admin"): Promise<TestUser> {
  const u = await createUser(t, handle);
  await t.c.identity.grantRole(u.userId, role);
  const token = (await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle, platform: "ANDROID", deviceId: u.deviceId } })).json().token as string;
  return { ...u, token };
}

/** Un post de `author` denunciado por un vecino; devuelve el id del caso. */
async function flaggedPost(author: TestUser): Promise<string> {
  const res = await t.app.inject({ method: "POST", url: "/v1/posts", headers: auth(author), payload: { text: `Mensaje denunciado número ${++n}` } });
  expect(res.statusCode, res.body).toBe(201);
  const postId = (res.json() as { postId: string }).postId;
  await t.app.inject({ method: "POST", url: "/v1/flags", headers: auth(vecino), payload: { targetType: "POST", targetId: postId, reason: "HARASSMENT" } });
  const cases = (await t.app.inject({ url: "/v1/moderation/cases?limit=50", headers: auth(admin) })).json().cases as CaseSummary[];
  return cases.find((c) => c.target.id === postId)!.id;
}

beforeAll(async () => {
  t = await createTestContext();
  mod = await withRole("mod_staffsusp", "moderator");
  admin = await withRole("adm_staffsusp", "admin");
  admin2 = await withRole("adm2_staffsusp", "admin");
  vecino = await createUser(t, "vecino_staffsusp");
});
afterAll(() => t.close());

describe("suspensiones de cuentas del personal (ADR 0327)", () => {
  it("moderación no suspende a un administrador y no queda registro", async () => {
    const caseId = await flaggedPost(admin2);
    const res = await act(mod, caseId, "SUSPEND_USER", { suspension: "PERMANENT" });
    expect(res.statusCode, res.body).toBe(403);
    expect(res.json().error).toBe("FORBIDDEN");
    expect(await status(admin2)).toBe("ACTIVE");
    expect(await suspensions(admin2)).toBe(0);
    // Lo demás de moderación sobre su contenido sigue igual (ocultar es apelable).
    expect((await act(mod, caseId, "HIDE")).statusCode).toBe(200);
  });

  it("una cuenta sin rol se sigue suspendiendo desde moderación", async () => {
    const autor = await createUser(t, "autor_staffsusp");
    const caseId = await flaggedPost(autor);
    expect((await act(mod, caseId, "SUSPEND_USER", { suspension: "HOURS_24" })).statusCode).toBe(200);
    expect(await status(autor)).toBe("SUSPENDED");
  });

  it("administración suspende a otro administrador; moderación no lo reactiva, ni por apelación", async () => {
    const otro = await withRole("adm3_staffsusp", "admin");
    const caseId = await flaggedPost(otro);
    const second = await flaggedPost(otro);
    expect((await act(admin, caseId, "SUSPEND_USER", { suspension: "DAYS_7" })).statusCode).toBe(200);
    expect(await status(otro)).toBe("SUSPENDED");
    // Suspendido no ejerce su rol.
    expect((await t.app.inject({ url: "/v1/admin/staff", headers: auth(otro) })).statusCode).toBe(403);

    // Reactivar directamente: solo administración.
    expect((await act(mod, second, "UNSUSPEND_USER")).statusCode).toBe(403);
    expect(await status(otro)).toBe("SUSPENDED");

    // Apelación: la decide alguien distinto de quien suspendió; moderación sin administración no puede revertir.
    const notice = ((await t.app.inject({ url: "/v1/me/moderation", headers: auth(otro) })).json().notices as ModerationNotice[])
      .find((x) => x.action.action === "SUSPEND_USER")!;
    expect((await t.app.inject({ method: "POST", url: `/v1/me/moderation/${notice.action.id}/appeal`, headers: auth(otro), payload: { text: "No fue una amenaza" } })).statusCode).toBe(201);
    const appeal = ((await t.app.inject({ url: "/v1/moderation/appeals", headers: auth(mod) })).json().appeals as AppealView[])
      .find((x) => x.action.id === notice.action.id)!;
    const decide = (u: TestUser) => t.app.inject({ method: "POST", url: `/v1/moderation/appeals/${appeal.id}/decision`, headers: auth(u), payload: { decision: "REVERSE", reason: "Revisado: no hubo amenaza" } });
    expect((await decide(mod)).statusCode).toBe(403);
    expect(await status(otro)).toBe("SUSPENDED");
    expect((await decide(admin2)).statusCode).toBe(200);
    expect(await status(otro)).toBe("ACTIVE");
    // Registro: quién suspendió y quién revirtió.
    const log = (await t.c.db.query<{ action: string; moderator_user_id: string }>(
      `SELECT action, moderator_user_id FROM moderation.actions WHERE affected_user_id = $1 AND action IN ('SUSPEND_USER','UNSUSPEND_USER') ORDER BY created_at`,
      [otro.userId])).rows;
    expect(log).toEqual([{ action: "SUSPEND_USER", moderator_user_id: admin.userId }, { action: "UNSUSPEND_USER", moderator_user_id: admin2.userId }]);
  });

  it("un administrador no se suspende a sí mismo", async () => {
    const caseId = await flaggedPost(admin);
    expect((await act(admin, caseId, "SUSPEND_USER", { suspension: "HOURS_24" })).statusCode).toBe(409);
    expect(await status(admin)).toBe("ACTIVE");
  });
});
