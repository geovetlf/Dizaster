import type { CaseSummary, DataExport } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, type TestContext, type TestUser } from "./helpers.js";

/**
 * Exportación y borrado con lo añadido el 2026-10-11 (ADR 0328): avisos de comentarios (ADR 0320), recuento de
 * reportes corroborados (ADR 0321) y suspensiones con duración (ADR 0319).
 */
let t: TestContext;
let mod: TestUser;
const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });
const post = async (u: TestUser, text: string) => {
  const res = await t.app.inject({ method: "POST", url: "/v1/posts", headers: auth(u), payload: { text } });
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as { postId: string }).postId;
};
const comment = async (u: TestUser, postId: string, text: string) => {
  const res = await t.app.inject({ method: "POST", url: `/v1/posts/${postId}/comments`, headers: auth(u), payload: { text } });
  expect(res.statusCode, res.body).toBe(201);
};
const commentNotices = async (u: TestUser) => (await t.c.db.query<{ n: number }>(
  `SELECT count(*)::int AS n FROM alert.notifications WHERE profile_id = $1 AND match IN ('COMMENTED','REPLIED')`, [u.profileId])).rows[0]!.n;

beforeAll(async () => {
  t = await createTestContext();
  const u = await createUser(t, "mod_privnew");
  await t.c.identity.grantRole(u.userId, "moderator");
  mod = { ...u, token: (await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle: "mod_privnew", platform: "ANDROID", deviceId: u.deviceId } })).json().token };
});
afterAll(() => t.close());

describe("exportación con los campos nuevos", () => {
  it("incluye avisos de comentarios, ocultar el recuento y la suspensión propia con su duración y fin", async () => {
    const yo = await createUser(t, "exporta_nuevo");
    const vecino = await createUser(t, "vecino_privnew");
    expect((await t.app.inject({ method: "PUT", url: "/v1/me/alert-preferences", headers: auth(yo), payload: { comments: true, replies: true } })).statusCode).toBe(200);
    expect((await t.app.inject({ method: "PATCH", url: "/v1/me", headers: auth(yo), payload: { showCorroboratedReports: false } })).statusCode).toBe(200);
    const postId = await post(yo, "Un post que alguien denuncia");
    await t.app.inject({ method: "POST", url: "/v1/flags", headers: auth(vecino), payload: { targetType: "POST", targetId: postId, reason: "SPAM" } });
    const caseId = ((await t.app.inject({ url: "/v1/moderation/cases?limit=50", headers: auth(mod) })).json().cases as CaseSummary[]).find((c) => c.target.id === postId)!.id;
    const acted = await t.app.inject({ method: "POST", url: `/v1/moderation/cases/${caseId}/actions`, headers: auth(mod), payload: { action: "SUSPEND_USER", reason: "Spam repetido en varios posts", suspension: "DAYS_7" } });
    expect(acted.statusCode, acted.body).toBe(200);
    const until = (await t.c.db.query<{ suspended_until: Date }>(`SELECT suspended_until FROM identity.users WHERE id = $1`, [yo.userId])).rows[0]!.suspended_until;

    const res = await t.app.inject({ url: "/v1/me/export", headers: auth(yo) });
    expect(res.statusCode, res.body).toBe(200);
    const s = (res.json() as DataExport).sections;
    expect(s.alerts["preferences"]![0]).toMatchObject({ comments: true, replies: true });
    expect(s.social["profile"]![0]).toMatchObject({ show_corroborated_reports: false });
    expect(s.identity["account"]![0]).toMatchObject({ status: "SUSPENDED", suspended_until: until.toISOString() });
    expect(s.moderation["actionsOnMyContent"]).toEqual([
      expect.objectContaining({ action: "SUSPEND_USER", suspension: "DAYS_7", suspended_until: until.toISOString() }),
    ]);
    // Nunca quién moderó ni quién denunció.
    expect(res.body).not.toContain(mod.userId);
    expect(res.body).not.toContain(vecino.profileId);
  });
});

describe("borrado de cuenta y avisos de comentarios", () => {
  it("borrar la cuenta de quien comentó retira sus avisos; borrar la de quien los recibía, también", async () => {
    const autora = await createUser(t, "autora_privnew");
    const comenta = await createUser(t, "comenta_privnew");
    const otra = await createUser(t, "otra_privnew");
    await t.app.inject({ method: "PUT", url: "/v1/me/alert-preferences", headers: auth(autora), payload: { comments: true } });
    await t.app.inject({ method: "PUT", url: "/v1/me/alert-preferences", headers: auth(otra), payload: { comments: true } });
    const p1 = await post(autora, "Post de la autora");
    const p2 = await post(otra, "Post de otra persona");
    await comment(comenta, p1, "Comentario que avisa");
    await comment(comenta, p2, "Otro comentario que avisa");
    await t.c.dispatcher.drain();
    expect(await commentNotices(autora)).toBe(1);
    expect(await commentNotices(otra)).toBe(1);

    // Quien comentó borra su cuenta: sus avisos a otras personas (que llevan su nombre) se van con ella.
    expect((await t.app.inject({ method: "DELETE", url: "/v1/me", headers: auth(comenta), payload: { confirm: "DELETE" } })).statusCode).toBe(202);
    await t.c.dispatcher.drain();
    expect(await commentNotices(autora)).toBe(0);
    expect(await commentNotices(otra)).toBe(0);
    expect((await t.c.db.query(`SELECT 1 FROM alert.alerts WHERE kind = 'COMMENT' AND actor_profile_id = $1`, [comenta.profileId])).rowCount).toBe(0);

    // Quien recibía avisos borra su cuenta: no quedan sus avisos ni sus preferencias.
    const tercera = await createUser(t, "tercera_privnew");
    await comment(tercera, p1, "Comentario nuevo para la autora");
    await t.c.dispatcher.drain();
    expect(await commentNotices(autora)).toBe(1);
    expect((await t.app.inject({ method: "DELETE", url: "/v1/me", headers: auth(autora), payload: { confirm: "DELETE" } })).statusCode).toBe(202);
    await t.c.dispatcher.drain();
    expect(await commentNotices(autora)).toBe(0);
    expect((await t.c.db.query(`SELECT 1 FROM alert.preferences WHERE profile_id = $1`, [autora.profileId])).rowCount).toBe(0);
  });
});
