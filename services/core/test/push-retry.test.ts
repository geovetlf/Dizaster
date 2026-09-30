import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PUSH_MAX_RETRIES, type PushMessage, type PushResult, type PushSender } from "../src/modules/alert/index.js";
import { isRetryableStatus } from "../src/modules/alert/push/types.js";
import { withTransaction } from "../src/platform/db.js";
import { createTestContext, createUser, type TestContext, type TestUser } from "./helpers.js";

/** Proveedor que responde lo que diga la prueba. */
class ScriptedPush implements PushSender {
  readonly name = "scripted";
  next: Omit<PushResult, "token"> = { ok: true, invalidToken: false };
  calls = 0;
  async send(messages: PushMessage[]): Promise<PushResult[]> {
    this.calls++;
    return messages.map((m) => ({ token: m.token, ...this.next }));
  }
}

// Reintento de avisos push con error temporal (ADR 0177). NO AI REQUIRED.
const push = new ScriptedPush();
let t: TestContext;
let u: TestUser;
beforeAll(async () => {
  t = await createTestContext({ push });
  u = await createUser(t, "pushretry");
  const res = await t.app.inject({
    method: "PUT", url: `/v1/devices/${u.deviceId}/push-token`, headers: { authorization: `Bearer ${u.token}` }, payload: { provider: "FCM", token: `tok-retry-${"x".repeat(20)}` },
  });
  expect(res.statusCode).toBe(204);
});
afterAll(async () => { await t.close(); });

const notice = (key: string) => withTransaction(t.c.db, (tx) => t.c.alerts.moderationNotice(tx, u.userId, key, "ACTION"));
const state = async (key: string) => (await t.c.db.query<{ status: string; attempts: number }>(
  `SELECT n.status, n.attempts FROM alert.notifications n JOIN alert.alerts a ON a.id = n.alert_id WHERE a.dedup_key = $1`, [key])).rows[0]!;
const due = () => t.c.db.query(`UPDATE alert.notifications SET next_attempt_at = now() - interval '1 second' WHERE next_attempt_at IS NOT NULL`);

describe("reintento de push", () => {
  it("clasifica los códigos temporales", () => {
    expect([0, 429, 500, 503].every(isRetryableStatus)).toBe(true);
    expect([400, 401, 403, 404, 410].some(isRetryableStatus)).toBe(false);
  });

  it("un error temporal vuelve a la cola con espera y se entrega en el reintento", async () => {
    expect(await notice("RETRY:1")).toBe(1);
    push.next = { ok: false, invalidToken: false, retryable: true, error: "HTTP 503" };
    expect((await t.c.alerts.flush()).PENDING).toBe(1);
    expect(await state("RETRY:1")).toEqual({ status: "PENDING", attempts: 1 });
    // Antes de que venza la espera no se reintenta.
    const calls = push.calls;
    await t.c.alerts.flush();
    expect(push.calls).toBe(calls);
    push.next = { ok: true, invalidToken: false };
    await due();
    expect((await t.c.alerts.flush()).SENT).toBe(1);
    expect(await state("RETRY:1")).toEqual({ status: "SENT", attempts: 1 });
  });

  it(`agotados ${PUSH_MAX_RETRIES} reintentos queda FAILED; un error definitivo, al instante`, async () => {
    await notice("RETRY:2");
    push.next = { ok: false, invalidToken: false, retryable: true, error: "HTTP 429" };
    for (let i = 0; i < PUSH_MAX_RETRIES; i++) { await t.c.alerts.flush(); await due(); }
    expect((await t.c.alerts.flush()).FAILED).toBe(1);
    expect(await state("RETRY:2")).toEqual({ status: "FAILED", attempts: PUSH_MAX_RETRIES });

    await notice("RETRY:3");
    push.next = { ok: false, invalidToken: false, error: "HTTP 400" };
    expect((await t.c.alerts.flush()).FAILED).toBe(1);
    expect(await state("RETRY:3")).toEqual({ status: "FAILED", attempts: 0 });
  });
});
