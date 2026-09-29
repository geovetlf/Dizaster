import type { AppealView, CaseDetail, CaseSummary, CommentView, FeedResponse, ModerationNotice, ProfileView } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AUTO_LIMIT_FLAGGERS } from "../src/modules/moderation/index.js";
import { createTestContext, createUser, LIMA, offset, reportBody, seedGeoFixtures, submit, type TestContext, type TestUser } from "./helpers.js";

let t: TestContext;
let mod: TestUser;
let mod2: TestUser;
const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });
const handleOf = async (u: TestUser) => (await t.c.db.query<{ handle: string }>(`SELECT handle FROM social.profiles WHERE id = $1`, [u.profileId])).rows[0]!.handle;
const postId = async (text: string) => (await t.c.db.query<{ id: string }>(`SELECT id FROM social.posts WHERE text = $1`, [text])).rows[0]!.id;
const flag = (u: TestUser, payload: object) => t.app.inject({ method: "POST", url: "/v1/flags", headers: auth(u), payload });
const queue = async () => (await t.app.inject({ url: "/v1/moderation/cases", headers: auth(mod) })).json() as { cases: CaseSummary[] };
const act = (u: TestUser, caseId: string, action: string, reason = "Incumple las normas de la comunidad") =>
  t.app.inject({ method: "POST", url: `/v1/moderation/cases/${caseId}/actions`, headers: auth(u), payload: { action, reason } });

async function asRole(handle: string, role: "moderator" | "admin"): Promise<TestUser> {
  const u = await createUser(t, handle);
  await t.c.identity.grantRole(u.userId, role);
  const token = (await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle, platform: "ANDROID", deviceId: u.deviceId } })).json().token as string;
  return { ...u, token };
}

beforeAll(async () => {
  t = await createTestContext();
  await seedGeoFixtures(t);
  mod = await asRole("moderadora", "moderator");
  mod2 = await asRole("moderador2", "moderator");
});
afterAll(() => t.close());

describe("denuncias y cola", () => {
  let autor: TestUser;
  let flaggers: TestUser[];

  beforeAll(async () => {
    autor = await createUser(t, "autor");
    flaggers = await Promise.all(Array.from({ length: AUTO_LIMIT_FLAGGERS + 1 }, (_, i) => createUser(t, `vecino${i}`)));
    await submit(t, autor, reportBody(autor, { category: "infra.power_outage", pin: offset(LIMA, 3000), text: "Aquí vive fulano, calle X 123" }));
    await submit(t, autor, reportBody(autor, { category: "infra.power_outage", pin: offset(LIMA, 9000), text: "Oferta de celulares baratos" }));
    await t.c.dispatcher.drain();
  });

  it("valida y responde igual siempre; una denuncia por persona", async () => {
    const id = await postId("Oferta de celulares baratos");
    expect((await flag(flaggers[0]!, { targetType: "POST", targetId: id, reason: "NOPE" })).statusCode).toBe(400);
    expect((await flag(flaggers[0]!, { targetType: "POST", targetId: "00000000-0000-7000-8000-000000000000", reason: "SPAM" })).statusCode).toBe(404);
    expect((await flag(flaggers[0]!, { targetType: "POST", targetId: id, reason: "SPAM" })).statusCode).toBe(202);
    expect((await flag(flaggers[0]!, { targetType: "POST", targetId: id, reason: "SPAM" })).json()).toEqual({ received: true });
    const c = (await queue()).cases.find((x) => x.target.id === id)!;
    expect(c).toMatchObject({ flagCount: 1, reasons: { SPAM: 1 }, target: { type: "POST", text: "Oferta de celulares baratos", state: "VISIBLE" } });
    expect((await t.app.inject({ url: "/v1/moderation/cases", headers: auth(autor) })).statusCode).toBe(403);
  });

  it("prioriza lo que daña a personas y limita solo tras muchas denuncias de cuentas establecidas", async () => {
    const id = await postId("Aquí vive fulano, calle X 123");
    for (const f of flaggers.slice(0, AUTO_LIMIT_FLAGGERS - 1)) await flag(f, { targetType: "POST", targetId: id, reason: "PRIVACY", note: "Publica una dirección" });
    const fresh = await createUser(t, "recien", 1);
    await flag(fresh, { targetType: "POST", targetId: id, reason: "PRIVACY" });
    expect((await t.c.db.query(`SELECT moderation_state FROM social.posts WHERE id = $1`, [id])).rows[0]).toEqual({ moderation_state: "VISIBLE" });
    const [first] = (await queue()).cases;
    expect(first!.target.id).toBe(id);
    // + 2 del evento vinculado sin verificar con poco alcance (ADR 0116).
    expect(first!.priority).toBeCloseTo((AUTO_LIMIT_FLAGGERS - 1) * 5 + 2.5 + 2, 1);

    await flag(flaggers[AUTO_LIMIT_FLAGGERS - 1]!, { targetType: "POST", targetId: id, reason: "PRIVACY" });
    expect((await t.c.db.query(`SELECT moderation_state FROM social.posts WHERE id = $1`, [id])).rows[0]).toEqual({ moderation_state: "LIMITED" });
    const feed = (await t.app.inject({ url: "/v1/feed?tab=for_you" })).json() as FeedResponse;
    expect(feed.posts.map((p) => p.text)).not.toContain("Aquí vive fulano, calle X 123");
    const detail = (await t.app.inject({ url: `/v1/moderation/cases/${first!.id}`, headers: auth(mod) })).json() as CaseDetail;
    expect(detail.actions).toMatchObject([{ action: "LIMIT", actor: "RULE" }]);
    expect(detail.notes[0]).toMatchObject({ reason: "PRIVACY", note: "Publica una dirección" });
    expect(JSON.stringify(detail)).not.toContain(flaggers[0]!.profileId);
  });

  it("acciones: motivo obligatorio, acciones válidas por tipo, cierre del caso y aviso a la persona afectada", async () => {
    const id = await postId("Aquí vive fulano, calle X 123");
    const c = (await queue()).cases.find((x) => x.target.id === id)!;
    expect((await act(mod, c.id, "REMOVE", "corto")).statusCode).toBe(400);
    expect((await act(mod, c.id, "MARK_DISPUTED")).statusCode).toBe(400);
    const done = (await act(mod, c.id, "REMOVE", "Publica la dirección de una persona sin su permiso")).json() as CaseDetail;
    expect(done.status).toBe("RESOLVED");
    expect(done.target.state).toBe("REMOVED");
    expect((await t.app.inject({ url: `/v1/posts/${id}/comments` })).statusCode).toBe(404);

    const notices = (await t.app.inject({ url: "/v1/me/moderation", headers: auth(autor) })).json().notices as ModerationNotice[];
    expect(notices.map((n) => n.action.action)).toEqual(["REMOVE", "LIMIT"]);
    expect(notices[0]).toMatchObject({ canAppeal: true, appeal: null, action: { reason: "Publica la dirección de una persona sin su permiso", actor: "MODERATOR" } });

    // Una nueva denuncia abre un caso nuevo; el resuelto queda en el historial.
    await flag(flaggers[AUTO_LIMIT_FLAGGERS]!, { targetType: "POST", targetId: id, reason: "PRIVACY" });
    expect((await queue()).cases.filter((x) => x.target.id === id)).toHaveLength(1);
  });

  it("apelación: la decide otra persona y revertir restaura el post", async () => {
    const id = await postId("Aquí vive fulano, calle X 123");
    const notice = ((await t.app.inject({ url: "/v1/me/moderation", headers: auth(autor) })).json().notices as ModerationNotice[])[0]!;
    expect((await t.app.inject({ method: "POST", url: `/v1/me/moderation/${notice.action.id}/appeal`, headers: auth(flaggers[0]!), payload: { text: "No es mío pero apelo igual" } })).statusCode).toBe(404);
    const appealed = await t.app.inject({ method: "POST", url: `/v1/me/moderation/${notice.action.id}/appeal`, headers: auth(autor), payload: { text: "Es la dirección de una tienda pública, no de una casa" } });
    expect(appealed.statusCode).toBe(201);
    expect(appealed.json()).toMatchObject({ canAppeal: false, appeal: { status: "OPEN" } });

    const open = (await t.app.inject({ url: "/v1/moderation/appeals", headers: auth(mod) })).json().appeals as AppealView[];
    expect(open).toHaveLength(1);
    const decide = (u: TestUser, decision: string) =>
      t.app.inject({ method: "POST", url: `/v1/moderation/appeals/${open[0]!.id}/decision`, headers: auth(u), payload: { decision, reason: "Es un comercio con dirección pública" } });
    expect((await decide(mod, "REVERSE")).statusCode).toBe(409);
    expect((await decide(mod2, "REVERSE")).json()).toMatchObject({ status: "REVERSED" });
    expect((await t.c.db.query(`SELECT moderation_state FROM social.posts WHERE id = $1`, [id])).rows[0]).toEqual({ moderation_state: "VISIBLE" });
    expect((await decide(mod2, "UPHOLD")).statusCode).toBe(409);
    const after = ((await t.app.inject({ url: "/v1/me/moderation", headers: auth(autor) })).json().notices as ModerationNotice[])[0]!;
    expect(after.appeal).toMatchObject({ status: "REVERSED", decisionReason: "Es un comercio con dirección pública" });
  });
});

describe("suspensión, seudónimos y eventos", () => {
  it("suspender: la cuenta puede leer y apelar pero no publicar; la autoría seudónima no se muestra a moderación", async () => {
    const anon = await createUser(t, "anonimo");
    const vecino = await createUser(t, "testigo");
    await submit(t, anon, { ...reportBody(anon, { category: "crime.robbery", pin: offset(LIMA, 20_000), text: "Amenazas a los vecinos" }), anonymityMode: "PSEUDONYMOUS" });
    await t.c.dispatcher.drain();
    const id = await postId("Amenazas a los vecinos");
    await flag(vecino, { targetType: "POST", targetId: id, reason: "HARASSMENT" });
    const c = (await queue()).cases.find((x) => x.target.id === id)!;
    expect(c.target.authorHandle).toBeNull();
    expect(JSON.stringify(await (await t.app.inject({ url: `/v1/moderation/cases/${c.id}`, headers: auth(mod) })).json())).not.toContain(await handleOf(anon));

    expect((await act(mod, c.id, "SUSPEND_USER", "Amenazas reiteradas a otras personas")).json()).toMatchObject({ status: "RESOLVED" });
    const blockedWrite = await t.app.inject({ method: "POST", url: `/v1/posts/${id}/comments`, headers: auth(anon), payload: { text: "hola" } });
    expect(blockedWrite.statusCode).toBe(403);
    expect(blockedWrite.json().error).toBe("ACCOUNT_SUSPENDED");
    expect((await t.app.inject({ url: "/v1/feed?tab=for_you", headers: auth(anon) })).statusCode).toBe(200);
    const notice = ((await t.app.inject({ url: "/v1/me/moderation", headers: auth(anon) })).json().notices as ModerationNotice[])[0]!;
    expect(notice.action.action).toBe("SUSPEND_USER");
    const appeal = await t.app.inject({ method: "POST", url: `/v1/me/moderation/${notice.action.id}/appeal`, headers: auth(anon), payload: { text: "Fue un malentendido con un vecino" } });
    expect(appeal.statusCode).toBe(201);
    const [a] = (await t.app.inject({ url: "/v1/moderation/appeals", headers: auth(mod2) })).json().appeals as AppealView[];
    await t.app.inject({ method: "POST", url: `/v1/moderation/appeals/${a!.id}/decision`, headers: auth(mod2), payload: { decision: "REVERSE", reason: "Primera vez; se levanta con advertencia" } });
    // La caché de estado es de 30 s por instancia; setUserStatus la invalida en esta.
    expect((await t.app.inject({ method: "POST", url: `/v1/posts/${id}/comments`, headers: auth(anon), payload: { text: "Perdón" } })).statusCode).toBe(201);
  });

  it("un evento denunciado se puede marcar en disputa desde el caso", async () => {
    const users = await Promise.all(["e1", "e2"].map((h) => createUser(t, h)));
    for (const u of users) await submit(t, u, reportBody(u, { category: "natural.flood", pin: offset(LIMA, -30_000) }));
    await t.c.dispatcher.drain();
    const eventId = (await t.c.db.query<{ id: string }>(`SELECT id FROM event.events WHERE category_code = 'natural.flood'`)).rows[0]!.id;
    await flag(users[0]!, { targetType: "EVENT", targetId: eventId, reason: "FALSE_INFO", note: "El agua ya bajó hace días" });
    const c = (await queue()).cases.find((x) => x.target.id === eventId)!;
    expect(c.target).toMatchObject({ type: "EVENT", categoryCode: "natural.flood" });
    expect((await act(mod, c.id, "REMOVE")).statusCode).toBe(400);
    expect((await act(mod, c.id, "MARK_DISPUTED", "Vecinos informan que el agua ya bajó")).json()).toMatchObject({ status: "RESOLVED" });
    await t.c.dispatcher.drain();
    expect((await t.app.inject({ url: `/v1/events/${eventId}` })).json().publicVerificationState).toBe("DISPUTED");
  });
});

describe("bloqueos", () => {
  it("oculta posts con nombre y comentarios del bloqueado, deja los seudónimos y corta el seguimiento", async () => {
    const yo = await createUser(t, "bloqueadora");
    const molesto = await createUser(t, "molesto");
    const h = await handleOf(molesto);
    await submit(t, molesto, reportBody(molesto, { category: "infra.power_outage", pin: offset(LIMA, 40_000), text: "Post con nombre de molesto" }));
    await submit(t, molesto, { ...reportBody(molesto, { category: "crime.robbery", pin: offset(LIMA, 42_000), text: "Aviso seudónimo de molesto" }), anonymityMode: "PSEUDONYMOUS" });
    await t.c.dispatcher.drain();
    const otro = await postId("Aviso seudónimo de molesto");
    await t.app.inject({ method: "POST", url: `/v1/posts/${otro}/comments`, headers: auth(molesto), payload: { text: "Comentario de molesto" } });
    await t.app.inject({ method: "PUT", url: `/v1/follows/profile/${h}`, headers: auth(yo) });

    expect((await t.app.inject({ method: "PUT", url: `/v1/blocks/${h}`, headers: auth(yo) })).json()).toEqual({ blocked: true });
    expect((await t.app.inject({ method: "PUT", url: `/v1/blocks/${await handleOf(yo)}`, headers: auth(yo) })).statusCode).toBe(400);
    const texts = ((await t.app.inject({ url: "/v1/feed?tab=for_you", headers: auth(yo) })).json() as FeedResponse).posts.map((p) => p.text);
    expect(texts).not.toContain("Post con nombre de molesto");
    expect(texts).toContain("Aviso seudónimo de molesto");
    expect(((await t.app.inject({ url: `/v1/posts/${otro}/comments`, headers: auth(yo) })).json().comments as CommentView[])).toEqual([]);
    expect(((await t.app.inject({ url: `/v1/posts/${otro}/comments` })).json().comments as CommentView[])).toHaveLength(1);
    expect((await t.app.inject({ url: `/v1/profiles/${h}`, headers: auth(yo) })).json() as ProfileView).toMatchObject({ blockedByMe: true, followedByMe: false });
    expect((await t.app.inject({ url: "/v1/me/blocks", headers: auth(yo) })).json()).toEqual({ handles: [h] });

    await t.app.inject({ method: "DELETE", url: `/v1/blocks/${h}`, headers: auth(yo) });
    expect(((await t.app.inject({ url: "/v1/feed?tab=for_you", headers: auth(yo) })).json() as FeedResponse).posts.map((p) => p.text)).toContain("Post con nombre de molesto");
  });
});

describe("prioridad por verificación (ADR 0116)", () => {
  it("lo no verificado o en disputa con alcance va antes; lo confirmado oficialmente, después", async () => {
    const { verificationPriority } = await import("../src/modules/moderation/index.js");
    expect(verificationPriority("DISPUTED", 1000)).toBeCloseTo(9, 1);
    expect(verificationPriority("UNVERIFIED", 0)).toBe(2);
    expect(verificationPriority("OFFICIALLY_CONFIRMED", 1000)).toBeLessThan(0);
    expect(verificationPriority("EXTERNALLY_CORROBORATED", 1000)).toBe(0);
    expect(verificationPriority("DISPUTED", 1000)).toBeGreaterThan(verificationPriority("COMMUNITY_CORROBORATED", 1000));
  });
});

describe("tomar casos (ADR 0134)", () => {
  it("quien toma un caso lo tiene 15 min: las demás no lo ven ni actúan; vence solo y se suelta al cerrar", async () => {
    const autor = await createUser(t, "autor_toma");
    const vecino = await createUser(t, "vecino_toma");
    const posted = await t.app.inject({ method: "POST", url: "/v1/posts", headers: auth(autor), payload: { text: "Publicación para tomar" } });
    const id = posted.json().postId as string;
    await flag(vecino, { targetType: "POST", targetId: id, reason: "SPAM" });
    const caseId = (await queue()).cases.find((x) => x.target.id === id)!.id;
    const claim = (u: TestUser) => t.app.inject({ method: "POST", url: `/v1/moderation/cases/${caseId}/claim`, headers: auth(u) });
    const queueOf = async (u: TestUser) => ((await t.app.inject({ url: "/v1/moderation/cases?limit=50", headers: auth(u) })).json() as { cases: CaseSummary[] }).cases;

    const mine = await claim(mod);
    expect(mine.statusCode).toBe(200);
    expect((mine.json() as CaseDetail).claim).toMatchObject({ mine: true });
    expect((await queueOf(mod)).find((x) => x.id === caseId)?.claim?.mine).toBe(true);
    expect((await queueOf(mod2)).some((x) => x.id === caseId)).toBe(false);
    expect((await claim(mod2)).json()).toMatchObject({ error: "CASE_CLAIMED" });
    expect((await act(mod2, caseId, "DISMISS")).statusCode).toBe(409);
    // Soltar solo lo hace quien lo tiene.
    await t.app.inject({ method: "DELETE", url: `/v1/moderation/cases/${caseId}/claim`, headers: auth(mod2) });
    expect((await claim(mod2)).statusCode).toBe(409);

    await t.c.db.query(`UPDATE moderation.cases SET claimed_until = now() - interval '1 minute' WHERE id = $1`, [caseId]);
    expect((await queueOf(mod2)).find((x) => x.id === caseId)?.claim).toBeNull();
    expect((await claim(mod2)).statusCode).toBe(200);
    expect((await act(mod2, caseId, "DISMISS")).statusCode).toBe(200);
    const closed = (await t.c.db.query(`SELECT status, claimed_by FROM moderation.cases WHERE id = $1`, [caseId])).rows[0];
    expect(closed).toEqual({ status: "DISMISSED", claimed_by: null });
    expect((await claim(mod)).json()).toMatchObject({ error: "CASE_CLOSED" });
  });
});
