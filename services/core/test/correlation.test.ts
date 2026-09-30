import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, reportBody, type TestContext } from "./helpers.js";

describe("correlación y actor en los eventos de dominio (§6.2, ADR 0172)", () => {
  let t: TestContext;
  beforeAll(async () => { t = await createTestContext(); });
  afterAll(async () => { await t.close(); });

  it("el id de la app viaja a los eventos, con el usuario como actor, y los derivados lo heredan", async () => {
    const u = await createUser(t, "corr");
    const rid = "0192aa00-1111-7000-8000-00000000c0de";
    const res = await t.app.inject({
      method: "POST", url: "/v1/reports", headers: { authorization: `Bearer ${u.token}`, "x-request-id": rid }, payload: reportBody(u),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-request-id"]).toBe(rid);

    const direct = await t.c.db.query<{ type: string; actor: string }>(`SELECT type, actor FROM platform.outbox WHERE correlation_id = $1`, [rid]);
    expect(direct.rows.length).toBeGreaterThan(0);
    expect(direct.rows.every((r) => r.actor === `user:${u.userId}`)).toBe(true);

    // Un consumidor que publica: su evento hereda la correlación y lo firma el sistema.
    const { publish } = await import("../src/platform/outbox.js");
    t.c.dispatcher.on(direct.rows[0]!.type as "CostDegradationChanged", "test-corr", async (_e, tx) => {
      await publish(tx, "CostDegradationChanged", { budgetKey: "corr", feature: "f", killed: false, percent: 1 });
    });
    await t.c.dispatcher.drain();
    const derived = await t.c.db.query<{ actor: string }>(
      `SELECT actor FROM platform.outbox WHERE correlation_id = $1 AND payload->>'budgetKey' = 'corr'`, [rid]);
    expect(derived.rows.map((r) => r.actor)).toEqual(["system:test-corr"]);
  });

  it("un id inválido se reemplaza y lo que no viene de una petición queda como sistema", async () => {
    const res = await t.app.inject({ method: "GET", url: "/health", headers: { "x-request-id": "<bad id>" } });
    const id = String(res.headers["x-request-id"]);
    expect(id).not.toBe("<bad id>");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    const { publish } = await import("../src/platform/outbox.js");
    await publish(t.c.db, "CostDegradationChanged", { budgetKey: "b", feature: "f", killed: false, percent: 1 });
    const r = await t.c.db.query<{ actor: string; correlation_id: string | null }>(
      `SELECT actor, correlation_id FROM platform.outbox WHERE payload->>'budgetKey' = 'b' ORDER BY occurred_at DESC LIMIT 1`);
    expect(r.rows[0]).toEqual({ actor: "system", correlation_id: null });
  });
});
