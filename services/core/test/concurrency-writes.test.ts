import type { AlertPreferences } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LIMA, createTestContext, createUser, offset, reportBody, type TestContext, type TestUser } from "./helpers.js";

/**
 * Carreras reales contra la API (ADR 0345): peticiones simultáneas con `Promise.all` sobre `app.inject` y varios
 * "workers" del outbox a la vez sobre el mismo pool. Cada caso fija el resultado que tendría la misma serie en orden.
 */
const CAP = 3;
let t: TestContext;
const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });
const count = async (sql: string, params: unknown[]) => (await t.c.db.query<{ n: number }>(sql, params)).rows[0]!.n;
const handleOf = async (u: TestUser) => (await t.c.db.query<{ handle: string }>(`SELECT handle FROM social.profiles WHERE id = $1`, [u.profileId])).rows[0]!.handle;
/** Cuatro workers del outbox a la vez hasta vaciarlo (cada `runOnce` toma su propia conexión del pool). */
async function drainInParallel(workers = 4): Promise<void> {
  for (;;) {
    const done = await Promise.all(Array.from({ length: workers }, () => t.c.dispatcher.runOnce(50)));
    if (done.every((n) => n === 0)) return;
  }
}
async function post(u: TestUser, payload: object): Promise<string> {
  const res = await t.app.inject({ method: "POST", url: "/v1/posts", headers: auth(u), payload });
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as { postId: string }).postId;
}

beforeAll(async () => { t = await createTestContext({ env: { SOCIAL_NOTICES_PER_DAY: String(CAP) } }); });
afterAll(async () => { await t.close(); });

describe("reportes simultáneos", () => {
  it("el mismo reporte enviado dos veces a la vez crea un solo reporte y ambas respuestas son la misma", async () => {
    const u = await createUser(t, "carrera_reporte");
    const body = reportBody(u, { pin: offset(LIMA, 20_000) });
    const res = await Promise.all([0, 1, 2].map(() => t.app.inject({ method: "POST", url: "/v1/reports", headers: auth(u), payload: body })));
    expect(res.map((r) => r.statusCode), res.map((r) => r.body).join("\n")).toEqual([200, 200, 200]);
    expect(res[1]!.json()).toEqual(res[0]!.json());
    expect(res[2]!.json()).toEqual(res[0]!.json());
    expect(await count(`SELECT count(*)::int AS n FROM report.reports WHERE author_user_id = $1`, [u.userId])).toBe(1);
    expect(await count(`SELECT count(*)::int AS n FROM social.posts WHERE author_id = $1`, [u.profileId])).toBe(1);
  });

  it("el cupo por hora se respeta aunque los reportes lleguen a la vez", async () => {
    const u = await createUser(t, "carrera_cupo");
    const quota = await t.c.trust.reportQuota(t.c.db, u.userId, t.c.env.REPORTS_PER_HOUR_LIMIT);
    const res = await Promise.all(Array.from({ length: quota + 4 }, (_, i) =>
      t.app.inject({ method: "POST", url: "/v1/reports", headers: auth(u), payload: reportBody(u, { pin: offset(LIMA, 30_000 + i * 3_000, 30_000) }) })));
    expect(res.filter((r) => r.statusCode === 200)).toHaveLength(quota);
    expect(res.filter((r) => r.statusCode === 429)).toHaveLength(4);
    expect(await count(`SELECT count(*)::int AS n FROM report.reports WHERE author_user_id = $1`, [u.userId])).toBe(quota);
  });
});

describe("reacciones y seguimientos simultáneos", () => {
  it("la misma reacción, me gusta o seguimiento repetidos a la vez quedan una sola vez", async () => {
    const autora = await createUser(t, "carrera_autora");
    const lectora = await createUser(t, "carrera_lectora");
    const postId = await post(autora, { text: "Hay humo en la esquina" });
    const likes = await Promise.all(Array.from({ length: 6 }, () => t.app.inject({ method: "PUT", url: `/v1/posts/${postId}/like`, headers: auth(lectora) })));
    expect(likes.map((r) => r.statusCode)).toEqual(Array(6).fill(200));
    const reacts = await Promise.all(Array.from({ length: 6 }, () => t.app.inject({ method: "PUT", url: `/v1/posts/${postId}/reactions/USEFUL`, headers: auth(lectora) })));
    expect(reacts.map((r) => r.statusCode)).toEqual(Array(6).fill(200));
    const handle = await handleOf(autora);
    const follows = await Promise.all(Array.from({ length: 6 }, () => t.app.inject({ method: "PUT", url: `/v1/follows/profile/${handle}`, headers: auth(lectora) })));
    expect(follows.map((r) => r.statusCode)).toEqual(Array(6).fill(200));
    expect(await count(`SELECT count(*)::int AS n FROM social.reactions WHERE post_id = $1 AND profile_id = $2`, [postId, lectora.profileId])).toBe(2);
    const view = (await t.app.inject({ url: `/v1/posts/${postId}`, headers: auth(lectora) })).json() as { likeCount: number; reactions: Record<string, number> };
    expect(view.likeCount).toBe(1);
    expect(view.reactions).toEqual({ LIKE: 1, USEFUL: 1 });
    const profile = (await t.app.inject({ url: `/v1/profiles/${handle}`, headers: auth(lectora) })).json() as { followerCount: number; followedByMe: boolean };
    expect(profile).toMatchObject({ followerCount: 1, followedByMe: true });
  });

  it("muchas personas a la vez: los contadores coinciden con las filas", async () => {
    const autora = await createUser(t, "carrera_popular");
    const postId = await post(autora, { text: "Corte de agua en el barrio" });
    const handle = await handleOf(autora);
    const fans = await Promise.all(Array.from({ length: 8 }, (_, i) => createUser(t, `carrera_fan_${i}`)));
    const first = await Promise.all(fans.flatMap((f) => [
      t.app.inject({ method: "PUT", url: `/v1/posts/${postId}/like`, headers: auth(f) }),
      t.app.inject({ method: "PUT", url: `/v1/follows/profile/${handle}`, headers: auth(f) }),
    ]));
    expect(first.map((r) => r.statusCode), first.map((r) => r.body).join("\n")).toEqual(Array(16).fill(200));
    // La mitad se arrepiente a la vez que la otra mitad repite.
    const second = await Promise.all(fans.map((f, i) => t.app.inject({ method: i % 2 ? "DELETE" : "PUT", url: `/v1/posts/${postId}/like`, headers: auth(f) })));
    expect(second.map((r) => r.statusCode), second.map((r) => r.body).join("\n")).toEqual(Array(8).fill(200));
    const view = (await t.app.inject({ url: `/v1/posts/${postId}` })).json() as { likeCount: number };
    expect(view.likeCount).toBe(4);
    expect(await count(`SELECT count(*)::int AS n FROM social.reactions WHERE post_id = $1 AND kind = 'LIKE'`, [postId])).toBe(4);
    const profile = (await t.app.inject({ url: `/v1/profiles/${handle}` })).json() as { followerCount: number };
    expect(profile.followerCount).toBe(8);
  });
});

describe("avisos de comentarios con tope diario (ADR 0320) y workers simultáneos", () => {
  it("varios workers procesando comentarios a la vez no superan el tope diario de avisos", async () => {
    const autora = await createUser(t, "carrera_tope");
    const prefs = await t.app.inject({ method: "PUT", url: "/v1/me/alert-preferences", headers: auth(autora), payload: { comments: true } satisfies Partial<AlertPreferences> });
    expect(prefs.statusCode, prefs.body).toBe(200);
    const postId = await post(autora, { text: "Se cayó un poste en la avenida" });
    const vecinos = await Promise.all(Array.from({ length: CAP + 5 }, (_, i) => createUser(t, `carrera_vecino_${i}`)));
    const res = await Promise.all(vecinos.map((v, i) =>
      t.app.inject({ method: "POST", url: `/v1/posts/${postId}/comments`, headers: auth(v), payload: { text: `Lo vi también (${i})` } })));
    expect(res.map((r) => r.statusCode)).toEqual(Array(CAP + 5).fill(201));
    // El contador de comentarios (trigger) tampoco se desfasa con escrituras simultáneas.
    expect(((await t.app.inject({ url: `/v1/posts/${postId}` })).json() as { commentCount: number }).commentCount).toBe(CAP + 5);
    await drainInParallel(CAP + 5);
    expect(await count(`SELECT count(*)::int AS n FROM alert.notifications WHERE profile_id = $1 AND match IN ('COMMENTED','REPLIED')`, [autora.profileId])).toBe(CAP);
  });
});

describe("suspensiones que vencen a la vez", () => {
  it("dos trabajos de vencimiento simultáneos reactivan cada cuenta una sola vez y la registran una vez", async () => {
    const users = await Promise.all([0, 1, 2].map((i) => createUser(t, `carrera_suspendida_${i}`)));
    for (const u of users) {
      await t.c.db.query(`UPDATE identity.users SET status = 'SUSPENDED', suspended_until = now() - interval '1 minute' WHERE id = $1`, [u.userId]);
      await t.c.db.query(
        `INSERT INTO moderation.actions (id, target_type, target_id, affected_user_id, action, actor, reason, suspension, suspended_until)
         VALUES (gen_random_uuid(), 'PROFILE', $1, $2, 'SUSPEND_USER', 'RULE', 'Prueba de vencimiento simultáneo', 'HOURS_24', now() - interval '1 minute')`,
        [u.profileId, u.userId],
      );
    }
    const runs = await Promise.all([0, 1, 2, 3].map(() => t.c.moderation.expireSuspensions(new Date())));
    expect(runs.reduce((s, r) => s + r.count, 0)).toBe(3);
    for (const u of users) {
      expect(await count(`SELECT count(*)::int AS n FROM moderation.actions WHERE affected_user_id = $1 AND action = 'UNSUSPEND_USER'`, [u.userId])).toBe(1);
      expect((await t.c.db.query(`SELECT status FROM identity.users WHERE id = $1`, [u.userId])).rows[0].status).toBe("ACTIVE");
    }
  });
});
