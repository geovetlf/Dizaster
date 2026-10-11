import type { AlertPreferences, NotificationsResponse } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commentText, type PushMessage, type PushResult, type PushSender } from "../src/modules/alert/index.js";
import { createTestContext, createUser, type TestContext, type TestUser } from "./helpers.js";

/**
 * Avisos de comentarios y respuestas (decisión del propietario, ADR 0315 y 0320): apagados por defecto en V1, la
 * persona los activa, tope diario configurable y nunca compiten con los avisos de incidentes.
 */
class RecordingPush implements PushSender {
  readonly name = "recording";
  sent: PushMessage[] = [];
  async send(messages: PushMessage[]): Promise<PushResult[]> {
    this.sent.push(...messages);
    return messages.map((m) => ({ token: m.token, ok: true, invalidToken: false }));
  }
  take(): PushMessage[] { const s = this.sent; this.sent = []; return s; }
}

const CAP = 3;
const push = new RecordingPush();
let t: TestContext;
let seq = 0;
const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });
const handleOf = async (u: TestUser) => (await t.c.db.query<{ handle: string }>(`SELECT handle FROM social.profiles WHERE id = $1`, [u.profileId])).rows[0]!.handle;
const settle = async () => { await t.c.dispatcher.drain(); await t.c.alerts.flush(); return push.take(); };
const inbox = async (u: TestUser) => (await t.app.inject({ url: "/v1/me/notifications", headers: auth(u) })).json() as NotificationsResponse;
const setPrefs = async (u: TestUser, p: Partial<AlertPreferences>) => {
  const res = await t.app.inject({ method: "PUT", url: "/v1/me/alert-preferences", headers: auth(u), payload: p });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as AlertPreferences;
};
const post = async (u: TestUser, text: string) => {
  const res = await t.app.inject({ method: "POST", url: "/v1/posts", headers: auth(u), payload: { text } });
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as { postId: string }).postId;
};
const comment = async (u: TestUser, postId: string, text: string, parentId?: string) => {
  const res = await t.app.inject({ method: "POST", url: `/v1/posts/${postId}/comments`, headers: auth(u), payload: { text, ...(parentId ? { parentId } : {}) } });
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as { id: string }).id;
};
async function withDevice(u: TestUser): Promise<string> {
  const token = `fcm-comment-${++seq}-${"x".repeat(20)}`;
  expect((await t.app.inject({ method: "PUT", url: `/v1/devices/${u.deviceId}/push-token`, headers: auth(u), payload: { provider: "FCM", token } })).statusCode).toBe(204);
  return token;
}
const socialRows = async (u: TestUser) => (await t.c.db.query<{ n: number }>(
  `SELECT count(*)::int AS n FROM alert.notifications WHERE profile_id = $1 AND match IN ('COMMENTED','REPLIED')`, [u.profileId])).rows[0]!.n;

beforeAll(async () => { t = await createTestContext({ push, env: { SOCIAL_NOTICES_PER_DAY: String(CAP) } }); });
afterAll(async () => t.close());

describe("avisos de comentarios y respuestas (ADR 0320)", () => {
  it("vienen apagados: comentar no avisa hasta que la persona los activa", async () => {
    const autora = await createUser(t, "autora_coment");
    const vecino = await createUser(t, "vecino_coment");
    const token = await withDevice(autora);
    const prefs = (await t.app.inject({ url: "/v1/me/alert-preferences", headers: auth(autora) })).json() as AlertPreferences;
    expect(prefs).toMatchObject({ comments: false, replies: false, mentions: true });
    const postId = await post(autora, "Se fue la luz en mi cuadra");
    await comment(vecino, postId, "Aquí también");
    expect((await settle()).filter((m) => m.token === token)).toHaveLength(0);
    expect(await socialRows(autora)).toBe(0);

    await setPrefs(autora, { comments: true });
    await comment(vecino, postId, "Ya volvió en la avenida, número 1234");
    const sent = (await settle()).filter((m) => m.token === token);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ url: `dizaster://post/${postId}`, title: commentText("es", await handleOf(vecino), "COMMENTED").title, data: { kind: "comment", postId } });
    // Nunca el texto del comentario.
    expect(JSON.stringify(sent[0])).not.toContain("1234");
    expect((await inbox(autora)).notifications[0]).toMatchObject({ kind: "COMMENT", match: "COMMENTED", postId, eventId: null });
    // Comentar lo propio no avisa.
    await comment(autora, postId, "Gracias por avisar");
    expect((await settle()).filter((m) => m.token === token)).toHaveLength(0);
  });

  it("una respuesta avisa a quien escribió el comentario respondido, si lo activó", async () => {
    const autora = await createUser(t, "autora_resp");
    const primero = await createUser(t, "primero_resp");
    const segundo = await createUser(t, "segundo_resp");
    const t1 = await withDevice(primero);
    const postId = await post(autora, "¿Alguien sabe si hay agua?");
    const c1 = await comment(primero, postId, "En mi zona no");
    await settle();
    await setPrefs(primero, { replies: true });
    await comment(segundo, postId, "En la mía tampoco", c1);
    const sent = (await settle()).filter((m) => m.token === t1);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.title).toBe(commentText("es", await handleOf(segundo), "REPLIED").title);
    expect((await inbox(primero)).notifications[0]).toMatchObject({ kind: "COMMENT", match: "REPLIED", postId });
  });

  it("no avisa a quien bloqueó a quien comenta", async () => {
    const autora = await createUser(t, "autora_bloq");
    const molesto = await createUser(t, "molesto_bloq");
    await setPrefs(autora, { comments: true });
    expect((await t.app.inject({ method: "PUT", url: `/v1/blocks/${await handleOf(molesto)}`, headers: auth(autora) })).statusCode).toBeLessThan(300);
    const postId = await post(autora, "Corte de agua programado");
    // Con el bloqueo, quien comenta no puede interactuar; si pudiera, igual no habría aviso.
    await t.app.inject({ method: "POST", url: `/v1/posts/${postId}/comments`, headers: auth(molesto), payload: { text: "Hola" } });
    await settle();
    expect(await socialRows(autora)).toBe(0);
  });

  it("tope diario por persona; por encima, el comentario queda pero no avisa", async () => {
    const autora = await createUser(t, "autora_tope");
    await setPrefs(autora, { comments: true });
    const postId = await post(autora, "Hay un árbol caído en la pista");
    for (let i = 0; i < CAP + 2; i++) await comment(await createUser(t, `vecino_tope_${i}`), postId, `Lo vi también (${i})`);
    await settle();
    expect(await socialRows(autora)).toBe(CAP);
    const comments = (await t.app.inject({ url: `/v1/posts/${postId}/comments` })).json().comments as unknown[];
    expect(comments).toHaveLength(CAP + 2);
  });

  it("no compite con los demás avisos: no gasta su límite por hora y sale en su propio push", async () => {
    const autora = await createUser(t, "autora_compite");
    const vecina = await createUser(t, "vecina_compite");
    const token = await withDevice(autora);
    await setPrefs(autora, { comments: true, maxPerHour: 1 });
    const postId = await post(autora, "Semáforo apagado en la esquina");
    await comment(vecina, postId, "Cuidado al cruzar");
    expect((await settle()).filter((m) => m.token === token)).toHaveLength(1);
    // El aviso social ya salió, pero el límite por hora (1) sigue libre para lo demás: una mención suena igual,
    // en su propio push y sin agruparse con el siguiente comentario.
    await comment(await createUser(t, "otra_compite"), postId, "Ya llegó la policía");
    await post(vecina, `Atención @${await handleOf(autora)}, cerraron la calle`);
    const sent = (await settle()).filter((m) => m.token === token);
    expect(sent.map((m) => m.data?.["kind"]).sort()).toEqual(["comment", "mention"]);
    const statuses = (await inbox(autora)).notifications.map((n) => n.delivery);
    expect(statuses).not.toContain("SILENT_RATE_LIMIT");
  });

  it("respeta las horas de silencio", async () => {
    const autora = await createUser(t, "autora_silencio");
    const token = await withDevice(autora);
    const now = new Date();
    const m = now.getUTCHours() * 60 + now.getUTCMinutes();
    await setPrefs(autora, { comments: true, timezone: "UTC", quietHours: { start: (m + 1439) % 1440, end: (m + 60) % 1440 } });
    const postId = await post(autora, "Ruido de sirenas cerca");
    await comment(await createUser(t, "vecino_silencio"), postId, "Fue un choque");
    expect((await settle()).filter((x) => x.token === token)).toHaveLength(0);
    expect((await inbox(autora)).notifications[0]!.delivery).toBe("SILENT_QUIET_HOURS");
  });
});
