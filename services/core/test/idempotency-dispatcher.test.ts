import type { DomainEventType } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PushMessage, PushResult, PushSender } from "../src/modules/alert/index.js";
import { LIMA, createTestContext, createUser, offset, reportBody, submit, type TestContext, type TestUser } from "./helpers.js";

/**
 * Reintentos del outbox (ADR 0346): un consumidor que falla una vez hace reintentar el evento entero; varios workers
 * procesan a la vez. Lo que los consumidores escriben (avisos, alertas, contribuciones, estado de verificación,
 * línea de tiempo) queda igual que con un solo worker sin fallos.
 */
let t: TestContext;
class RecordingPush implements PushSender {
  readonly name = "recording";
  sent: PushMessage[] = [];
  async send(messages: PushMessage[]): Promise<PushResult[]> {
    // Una pausa real: los envíos simultáneos se solapan como con un proveedor de red.
    await new Promise((r) => setTimeout(r, 20));
    this.sent.push(...messages);
    return messages.map((m) => ({ token: m.token, ok: true, invalidToken: false }));
  }
}
const push = new RecordingPush();
const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });
const FLAKY: DomainEventType[] = ["EventCreated", "EventEvidenceAdded", "VerificationChanged", "UserMentioned", "CommentAdded", "AlertTriggered"];
const failedOnce = new Set<string>();
let flaky = false;
let places = 0;

/**
 * Tablas que escriben los consumidores del outbox; su recuento no cambia aunque se vuelva a entregar todo. Fuera queda
 * `event.timeline`: `event.mirror-verification` añade una entrada VERIFICATION_CHANGED por entrega y solo lo protege
 * el registro de consumo (ver ADR 0346).
 */
const WRITTEN_BY_CONSUMERS = [
  "alert.alerts", "alert.notifications", "alert.event_state", "event.evidence", "event.duplicate_candidates",
  "verification.state", "verification.transitions", "verification.ai_jobs", "trust.contributions", "trust.event_outcomes", "trust.sanctions",
  "moderation.cases", "moderation.actions", "social.posts", "social.follows",
];

async function counts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of WRITTEN_BY_CONSUMERS) {
    out[table] = (await t.c.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]!.n;
  }
  return out;
}

/** Varios workers a la vez; lo que quedó para reintento vuelve a estar disponible enseguida. */
async function processAll(workers = 4): Promise<void> {
  for (let round = 0; round < 50; round++) {
    const done = await Promise.all(Array.from({ length: workers }, () => t.c.dispatcher.runOnce(25)));
    if (done.every((n) => n === 0)) {
      const retry = await t.c.db.query(`UPDATE platform.outbox SET available_at = now() WHERE processed_at IS NULL AND dead_at IS NULL AND available_at > now()`);
      if (!retry.rowCount) return;
    }
  }
  throw new Error("el outbox no se vació");
}

async function scenario(tag: string): Promise<{ eventId: string; zone: TestUser; mentioned: TestUser; author: TestUser }> {
  // Cada escenario en su propio lugar: no se suma al evento de otro.
  const pin = offset(LIMA, 15_000 + places++ * 6_000, 15_000);
  const zone = await createUser(t, `${tag}_zona`);
  expect((await t.app.inject({ method: "POST", url: "/v1/me/zones", headers: auth(zone), payload: { kind: "HOME", lat: pin.lat, lng: pin.lng, radiusKm: 2 } })).statusCode).toBe(201);
  const reporters = await Promise.all([0, 1, 2].map((i) => createUser(t, `${tag}_rep${i}`)));
  let eventId = "";
  for (const [i, u] of reporters.entries()) {
    const r = await submit(t, u, reportBody(u, { category: "fire.structure", pin: offset(pin, i * 30) }));
    expect(r.status).toBe(200);
    eventId ||= r.body.eventId!;
  }
  const mentioned = await createUser(t, `${tag}_mencion`);
  const author = await createUser(t, `${tag}_autora`);
  expect((await t.app.inject({ method: "PUT", url: "/v1/me/alert-preferences", headers: auth(author), payload: { comments: true } })).statusCode).toBe(200);
  const handle = (await t.c.db.query<{ handle: string }>(`SELECT handle FROM social.profiles WHERE id = $1`, [mentioned.profileId])).rows[0]!.handle;
  const postRes = await t.app.inject({ method: "POST", url: "/v1/posts", headers: auth(author), payload: { text: `Humo cerca, @${handle} ten cuidado`, eventId } });
  expect(postRes.statusCode, postRes.body).toBe(201);
  const postId = (postRes.json() as { postId: string }).postId;
  expect((await t.app.inject({ method: "POST", url: `/v1/posts/${postId}/comments`, headers: auth(mentioned), payload: { text: "Gracias" } })).statusCode).toBe(201);
  return { eventId, zone, mentioned, author };
}

beforeAll(async () => {
  t = await createTestContext({ push });
  for (const type of FLAKY) {
    t.c.dispatcher.on(type, `test.flaky.${type}`, async (e) => {
      if (flaky && !failedOnce.has(e.id)) { failedOnce.add(e.id); throw new Error("fallo transitorio de prueba"); }
    });
  }
});
afterAll(async () => { await t.close(); });

/** Lo que los consumidores dejaron sobre un escenario: avisos por persona y motivo, evidencia y línea de tiempo del evento. */
async function footprint(s: Awaited<ReturnType<typeof scenario>>) {
  const inbox = async (u: TestUser) => (await t.c.db.query<{ match: string; n: number }>(
    `SELECT n.match, count(*)::int AS n FROM alert.notifications n WHERE n.profile_id = $1 GROUP BY n.match ORDER BY n.match`, [u.profileId])).rows;
  const byEvent = async (sql: string) => (await t.c.db.query(sql, [s.eventId])).rows;
  return {
    zone: await inbox(s.zone),
    mentioned: await inbox(s.mentioned),
    author: await inbox(s.author),
    evidence: await byEvent(`SELECT evidence_type, status, count(*)::int AS n FROM event.evidence WHERE event_id = $1 GROUP BY 1, 2 ORDER BY 1, 2`),
    timeline: await byEvent(`SELECT type, count(*)::int AS n FROM event.timeline WHERE event_id = $1 GROUP BY type ORDER BY type`),
    alerts: await byEvent(`SELECT kind, count(*)::int AS n FROM alert.alerts WHERE event_id = $1 GROUP BY kind ORDER BY kind`),
    verification: await byEvent(`SELECT level, negative_state FROM verification.state WHERE event_id = $1`),
    contributions: await byEvent(`SELECT count(*)::int AS n FROM trust.contributions WHERE event_id = $1`),
  };
}

describe("reintentos del outbox", () => {
  it("con fallos transitorios y cuatro workers a la vez queda lo mismo que con un worker sin fallos", async () => {
    const clean = await scenario("limpio");
    await t.c.dispatcher.drain();
    const expected = await footprint(clean);
    expect(expected.zone).toEqual([{ match: "SAVED_ZONE", n: 1 }]);
    expect(expected.mentioned).toEqual([{ match: "MENTIONED", n: 1 }]);
    expect(expected.author).toEqual([{ match: "COMMENTED", n: 1 }]);
    expect(expected.evidence).toEqual([{ evidence_type: "CITIZEN_REPORT", status: "ACTIVE", n: 3 }]);

    flaky = true;
    const retried = await scenario("reintento");
    await processAll();
    flaky = false;
    expect(failedOnce.size).toBeGreaterThan(5);
    expect((await t.c.db.query(`SELECT 1 FROM platform.outbox WHERE dead_at IS NOT NULL OR processed_at IS NULL`)).rowCount).toBe(0);
    expect(await footprint(retried)).toEqual(expected);
  });

  it("volver a entregar todo lo ya procesado no duplica avisos, alertas, evidencias ni contribuciones", async () => {
    await scenario("reentrega");
    await processAll();
    const before = await counts();
    // Entrega «al menos una vez» en el peor caso: el outbox entero vuelve a la cola, sin registro de consumo. En la
    // práctica no ocurre (el consumo se registra en la misma transacción que el trabajo), pero los consumidores que
    // escriben avisos y evidencia no deben depender de eso.
    await t.c.db.query(`DELETE FROM platform.outbox_consumption`);
    await t.c.db.query(`UPDATE platform.outbox SET processed_at = NULL, available_at = now()`);
    await processAll();
    expect(await counts()).toEqual(before);
  });

  it("varios envíos de push a la vez mandan cada aviso una sola vez", async () => {
    const s = await scenario("envio");
    for (const [i, u] of [s.zone, s.mentioned, s.author].entries()) {
      const res = await t.app.inject({ method: "PUT", url: `/v1/devices/${u.deviceId}/push-token`, headers: auth(u), payload: { provider: "FCM", token: `fcm-reintento-${i}-${"x".repeat(24)}` } });
      expect(res.statusCode, res.body).toBe(204);
    }
    await processAll();
    push.sent = [];
    await Promise.all([0, 1, 2, 3].map(() => t.c.alerts.flush()));
    const ids = push.sent.map((m) => (m.data as { notificationId?: string }).notificationId).filter(Boolean);
    expect(ids.length).toBeGreaterThanOrEqual(3);
    expect(new Set(ids).size).toBe(ids.length);
    const pending = await t.c.db.query(`SELECT 1 FROM alert.notifications WHERE profile_id = ANY($1) AND status = 'PENDING'`, [[s.zone.profileId, s.mentioned.profileId, s.author.profileId]]);
    expect(pending.rowCount).toBe(0);
  });
});
