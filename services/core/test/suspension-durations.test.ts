import type { AppealView, CaseDetail, CaseSummary, ModerationNotice } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, LIMA, offset, reportBody, submit, type TestContext, type TestUser } from "./helpers.js";

/**
 * Suspensiones escalonadas (decisión del propietario, ADR 0315 y 0319): 24 horas, 7 días o permanente, apelables,
 * con registro auditable de motivo, duración, quién la aplicó y el resultado de la apelación.
 */
let t: TestContext;
let mod: TestUser;
let mod2: TestUser;
let vecino: TestUser;
let n = 0;
const HOUR = 3_600_000;
const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });
const act = (u: TestUser, caseId: string, action: string, extra: object = {}) =>
  t.app.inject({ method: "POST", url: `/v1/moderation/cases/${caseId}/actions`, headers: auth(u), payload: { action, reason: "Amenazas reiteradas a otras personas", ...extra } });
const comment = (u: TestUser, postId: string) =>
  t.app.inject({ method: "POST", url: `/v1/posts/${postId}/comments`, headers: auth(u), payload: { text: "Un comentario" } });
const account = async (u: TestUser) => (await t.c.db.query<{ status: string; suspended_until: Date | null }>(
  `SELECT status, suspended_until FROM identity.users WHERE id = $1`, [u.userId])).rows[0]!;

async function asRole(handle: string): Promise<TestUser> {
  const u = await createUser(t, handle);
  await t.c.identity.grantRole(u.userId, "moderator");
  const token = (await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle, platform: "ANDROID", deviceId: u.deviceId } })).json().token as string;
  return { ...u, token };
}

/** Un post de `author` denunciado por un vecino: devuelve el id del post y el del caso. */
async function flaggedPost(author: TestUser): Promise<{ postId: string; caseId: string }> {
  n++;
  const text = `Mensaje amenazante número ${n}`;
  const r = await submit(t, author, reportBody(author, { category: "infra.power_outage", pin: offset(LIMA, 2000 * n, 3000), text }));
  const postId = r.body.postId as string;
  await t.app.inject({ method: "POST", url: "/v1/flags", headers: auth(vecino), payload: { targetType: "POST", targetId: postId, reason: "HARASSMENT" } });
  const cases = (await t.app.inject({ url: "/v1/moderation/cases?limit=50", headers: auth(mod) })).json().cases as CaseSummary[];
  return { postId, caseId: cases.find((c) => c.target.id === postId)!.id };
}

beforeAll(async () => {
  t = await createTestContext();
  mod = await asRole("mod_susp");
  mod2 = await asRole("mod_susp2");
  vecino = await createUser(t, "vecino_susp");
});
afterAll(() => t.close());

describe("suspensiones escalonadas", () => {
  it("la duración es obligatoria al suspender y no vale en otra acción; sin rol no se suspende", async () => {
    const autor = await createUser(t, "susp_valida");
    const { caseId } = await flaggedPost(autor);
    expect((await act(mod, caseId, "SUSPEND_USER")).statusCode).toBe(400);
    expect((await act(mod, caseId, "SUSPEND_USER", { suspension: "DAYS_30" })).statusCode).toBe(400);
    expect((await act(mod, caseId, "HIDE", { suspension: "DAYS_7" })).statusCode).toBe(400);
    expect((await act(vecino, caseId, "SUSPEND_USER", { suspension: "PERMANENT" })).statusCode).toBe(403);
    expect((await account(autor)).status).toBe("ACTIVE");
  });

  it("24 horas: bloquea la escritura, queda registrada y vence sola con su registro automático", async () => {
    const autor = await createUser(t, "susp_24h");
    const { postId, caseId } = await flaggedPost(autor);
    const before = Date.now();
    const detail = (await act(mod, caseId, "SUSPEND_USER", { suspension: "HOURS_24" })).json() as CaseDetail;
    const action = detail.actions.find((a) => a.action === "SUSPEND_USER")!;
    expect(action.suspension!.duration).toBe("HOURS_24");
    const until = Date.parse(action.suspension!.until!);
    expect(until - before).toBeGreaterThanOrEqual(24 * HOUR - 5_000);
    expect(until - before).toBeLessThanOrEqual(24 * HOUR + 60_000);
    expect((await comment(autor, postId)).json().error).toBe("ACCOUNT_SUSPENDED");

    // Registro auditable: motivo, duración, fin y quién la aplicó.
    const log = (await t.c.db.query(
      `SELECT reason, suspension, suspended_until, moderator_user_id, actor FROM moderation.actions WHERE id = $1`, [action.id])).rows[0];
    expect(log).toMatchObject({ reason: "Amenazas reiteradas a otras personas", suspension: "HOURS_24", moderator_user_id: mod.userId, actor: "MODERATOR" });
    // La persona ve la duración en su aviso.
    const notice = ((await t.app.inject({ url: "/v1/me/moderation", headers: auth(autor) })).json().notices as ModerationNotice[])[0]!;
    expect(notice.action.suspension).toEqual({ duration: "HOURS_24", until: action.suspension!.until });

    expect((await t.c.moderation.expireSuspensions(new Date(Date.now() + 23 * HOUR))).count).toBe(0);
    expect((await t.c.moderation.expireSuspensions(new Date(Date.now() + 25 * HOUR))).count).toBe(1);
    expect(await account(autor)).toEqual({ status: "ACTIVE", suspended_until: null });
    expect((await comment(autor, postId)).statusCode).toBe(201);
    const auto = (await t.c.db.query(
      `SELECT actor, moderator_user_id, target_id FROM moderation.actions WHERE affected_user_id = $1 AND action = 'UNSUSPEND_USER'`, [autor.userId])).rows;
    expect(auto).toEqual([{ actor: "RULE", moderator_user_id: null, target_id: postId }]);
  });

  it("una suspensión vencida deja de contar aunque el trabajo horario no haya pasado", async () => {
    const autor = await createUser(t, "susp_vencida");
    const { postId, caseId } = await flaggedPost(autor);
    await act(mod, caseId, "SUSPEND_USER", { suspension: "HOURS_24" });
    await t.c.db.query(`UPDATE identity.users SET suspended_until = now() - interval '1 minute' WHERE id = $1`, [autor.userId]);
    expect((await comment(autor, postId)).statusCode).toBe(201);
  });

  it("queda el fin más lejano: una suspensión corta no acorta una larga ni una permanente", async () => {
    const autor = await createUser(t, "susp_varias");
    const a = await flaggedPost(autor);
    const b = await flaggedPost(autor);
    const c = await flaggedPost(autor);
    await act(mod, a.caseId, "SUSPEND_USER", { suspension: "DAYS_7" });
    const week = (await account(autor)).suspended_until!.getTime();
    await act(mod, b.caseId, "SUSPEND_USER", { suspension: "HOURS_24" });
    expect((await account(autor)).suspended_until!.getTime()).toBe(week);
    await act(mod, c.caseId, "SUSPEND_USER", { suspension: "PERMANENT" });
    expect(await account(autor)).toEqual({ status: "SUSPENDED", suspended_until: null });
    await t.c.moderation.expireSuspensions(new Date(Date.now() + 400 * 24 * HOUR));
    expect((await account(autor)).status).toBe("SUSPENDED");
  });

  it("apelable: revertirla reactiva la cuenta y el resultado queda registrado", async () => {
    const autor = await createUser(t, "susp_apela");
    const { postId, caseId } = await flaggedPost(autor);
    await act(mod, caseId, "SUSPEND_USER", { suspension: "PERMANENT" });
    const notice = ((await t.app.inject({ url: "/v1/me/moderation", headers: auth(autor) })).json().notices as ModerationNotice[])[0]!;
    expect(notice).toMatchObject({ canAppeal: true, action: { suspension: { duration: "PERMANENT", until: null } } });
    await t.app.inject({ method: "POST", url: `/v1/me/moderation/${notice.action.id}/appeal`, headers: auth(autor), payload: { text: "Fue un malentendido con un vecino" } });
    const appeal = ((await t.app.inject({ url: "/v1/moderation/appeals", headers: auth(mod2) })).json().appeals as AppealView[])
      .find((x) => x.action.id === notice.action.id)!;
    expect(appeal.action.suspension).toEqual({ duration: "PERMANENT", until: null });
    // Quien suspendió no decide la apelación.
    expect((await t.app.inject({ method: "POST", url: `/v1/moderation/appeals/${appeal.id}/decision`, headers: auth(mod),
      payload: { decision: "REVERSE", reason: "Primera vez; se levanta" } })).statusCode).toBe(409);
    await t.app.inject({ method: "POST", url: `/v1/moderation/appeals/${appeal.id}/decision`, headers: auth(mod2), payload: { decision: "REVERSE", reason: "Primera vez; se levanta" } });
    expect(await account(autor)).toEqual({ status: "ACTIVE", suspended_until: null });
    expect((await t.c.db.query(`SELECT status, decided_by FROM moderation.appeals WHERE id = $1`, [appeal.id])).rows[0]).toEqual({ status: "REVERSED", decided_by: mod2.userId });
    expect((await comment(autor, postId)).statusCode).toBe(201);
  });

  it("el registro no se puede cambiar, nadie se suspende a sí mismo y una persona suspendida no modera", async () => {
    const id = (await t.c.db.query<{ id: string }>(`SELECT id FROM moderation.actions WHERE action = 'SUSPEND_USER' LIMIT 1`)).rows[0]!.id;
    await expect(t.c.db.query(`UPDATE moderation.actions SET suspension = 'HOURS_24' WHERE id = $1`, [id])).rejects.toThrow(/solo se inserta/);
    await expect(t.c.db.query(`DELETE FROM moderation.actions WHERE id = $1`, [id])).rejects.toThrow(/solo se inserta/);

    const own = await flaggedPost(mod2);
    expect((await act(mod2, own.caseId, "SUSPEND_USER", { suspension: "PERMANENT" })).statusCode).toBe(409);
    expect((await act(mod, own.caseId, "SUSPEND_USER", { suspension: "HOURS_24" })).statusCode).toBe(200);
    const other = await flaggedPost(await createUser(t, "susp_otro"));
    expect((await act(mod2, other.caseId, "HIDE")).statusCode).toBe(403);
    await t.c.moderation.expireSuspensions(new Date(Date.now() + 25 * HOUR));
    expect((await act(mod2, other.caseId, "HIDE")).statusCode).toBe(200);
  });
});
