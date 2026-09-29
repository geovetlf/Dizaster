import type { AlertPreferences, NotificationsResponse } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MENTION_LIMITS, localMinutes, mentionText, type PushMessage, type PushResult, type PushSender } from "../src/modules/alert/index.js";
import { createTestContext, createUser, type TestContext, type TestUser } from "./helpers.js";

class RecordingPush implements PushSender {
  readonly name = "recording";
  sent: PushMessage[] = [];
  async send(messages: PushMessage[]): Promise<PushResult[]> {
    this.sent.push(...messages);
    return messages.map((m) => ({ token: m.token, ok: true, invalidToken: false }));
  }
  take(): PushMessage[] { const s = this.sent; this.sent = []; return s; }
}

const push = new RecordingPush();
let t: TestContext;
let author: TestUser;
let friend: TestUser;
let friendHandle: string;
let friendToken: string;
const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });
const handleOf = async (u: TestUser) => (await t.c.db.query<{ handle: string }>(`SELECT handle FROM social.profiles WHERE id = $1`, [u.profileId])).rows[0]!.handle;
const post = async (u: TestUser, text: string, anonymityMode = "PUBLIC") => {
  const res = await t.app.inject({ method: "POST", url: "/v1/posts", headers: auth(u), payload: { text, anonymityMode } });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as { postId: string; mentions: string[] };
};
const settle = async () => { await t.c.dispatcher.drain(); await t.c.alerts.flush(); return push.take(); };
const inbox = async (u: TestUser) => (await t.app.inject({ url: "/v1/me/notifications", headers: auth(u) })).json() as NotificationsResponse;
const setPrefs = async (u: TestUser, p: Partial<AlertPreferences>) => {
  const res = await t.app.inject({ method: "PUT", url: "/v1/me/alert-preferences", headers: auth(u), payload: p });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as AlertPreferences;
};
let seq = 0;
async function withDevice(u: TestUser): Promise<string> {
  const token = `fcm-mention-${++seq}-${"x".repeat(20)}`;
  expect((await t.app.inject({ method: "PUT", url: `/v1/devices/${u.deviceId}/push-token`, headers: auth(u), payload: { provider: "FCM", token } })).statusCode).toBe(204);
  return token;
}

beforeAll(async () => {
  t = await createTestContext({ push });
  author = await createUser(t, "autora_mencion");
  friend = await createUser(t, "amiga_mencion");
  friendHandle = await handleOf(friend);
  friendToken = await withDevice(friend);
  // Cada prueba empieza sin límite por hora de la persona (6 por defecto) para medir solo lo de menciones.
  await setPrefs(friend, { maxPerHour: 30 });
});
afterAll(async () => t.close());

describe("aviso por mención (D-MENTION, ADR 0063)", () => {
  it("una @mención genera un push que lleva al post y nombra a quien escribió", async () => {
    const { postId } = await post(author, `Hola @${friendHandle}, ¿estás bien?`);
    const sent = (await settle()).filter((m) => m.token === friendToken);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ url: `dizaster://post/${postId}`, title: mentionText("es", await handleOf(author)).title, data: { kind: "mention", postId } });
    expect(sent[0]!.body).not.toContain("estás bien");
    const n = (await inbox(friend)).notifications[0]!;
    expect(n).toMatchObject({ kind: "MENTION", match: "MENTIONED", postId, eventId: null, categoryCode: null, url: `dizaster://post/${postId}` });
  });

  it("un post seudónimo no revela a su autor en el aviso", async () => {
    await post(author, `Cuidado con la calle, @${friendHandle}`, "PSEUDONYMOUS");
    const sent = (await settle()).filter((m) => m.token === friendToken);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.title).toBe(mentionText("es", null).title);
    expect(JSON.stringify(sent[0])).not.toContain(await handleOf(author));
  });

  it("anti-spam: la misma cuenta avisa a la misma persona como mucho 3 veces por día", async () => {
    const other = await createUser(t, "insistente_mencion");
    for (let i = 0; i < MENTION_LIMITS.perPairPerDay + 2; i++) await post(other, `Mira esto @${friendHandle} (${i})`);
    const sent = (await settle()).filter((m) => m.token === friendToken);
    // Varios avisos a la vez se agrupan; lo que cuenta es cuántas notificaciones de esta cuenta existen.
    expect(sent.length).toBeGreaterThan(0);
    const { rows } = await t.c.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM alert.notifications n JOIN alert.alerts a ON a.id = n.alert_id
        WHERE a.actor_profile_id = $1 AND n.profile_id = $2`, [other.profileId, friend.profileId],
    );
    expect(rows[0]!.n).toBe(MENTION_LIMITS.perPairPerDay);
  });

  it("respeta el bloqueo, la preferencia y las horas de silencio", async () => {
    const rude = await createUser(t, "bloqueado_mencion");
    await t.app.inject({ method: "PUT", url: `/v1/blocks/${await handleOf(rude)}`, headers: auth(friend) });
    await post(rude, `@${friendHandle} hola`);
    expect((await settle()).filter((m) => m.token === friendToken)).toEqual([]);

    await setPrefs(friend, { mentions: false });
    await post(author, `Otra vez @${friendHandle}`);
    expect((await settle()).filter((m) => m.token === friendToken)).toEqual([]);

    const m = localMinutes(new Date(), "UTC");
    await setPrefs(friend, { mentions: true, quietHours: { start: (m + 1440 - 30) % 1440, end: (m + 30) % 1440 }, timezone: "UTC" });
    const { postId } = await post(author, `Silencio @${friendHandle}`);
    expect((await settle()).filter((m) => m.token === friendToken)).toEqual([]);
    const quiet = (await inbox(friend)).notifications.find((n) => n.postId === postId);
    expect(quiet?.delivery).toBe("SILENT_QUIET_HOURS");
    await setPrefs(friend, { quietHours: null });
  });

  it("una misma mención nunca avisa dos veces (reentrega del outbox)", async () => {
    const { postId } = await post(author, `Una vez @${friendHandle}`);
    await settle();
    const again = await t.c.alerts.mention(t.c.db, { postId, authorProfileId: author.profileId, profileIds: [friend.profileId] });
    expect(again).toBe(0);
  });

  it("borrar la cuenta de quien mencionó se lleva sus avisos", async () => {
    const gone = await createUser(t, "se_va_mencion");
    await post(gone, `Chau @${friendHandle}`);
    await settle();
    expect((await t.app.inject({ method: "DELETE", url: "/v1/me", headers: auth(gone), payload: { confirm: "DELETE" } })).statusCode).toBeLessThan(300);
    await t.c.dispatcher.drain();
    const { rows } = await t.c.db.query(`SELECT 1 FROM alert.alerts WHERE actor_profile_id = $1`, [gone.profileId]);
    expect(rows).toHaveLength(0);
  });
});
