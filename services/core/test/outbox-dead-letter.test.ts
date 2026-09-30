import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OutboxDispatcher, publish } from "../src/platform/outbox.js";
import { createTestContext, type TestContext } from "./helpers.js";

// Cuarentena del outbox (ADR 0206): un evento que siempre falla deja de reintentarse y de contar como atasco.
let t: TestContext;
beforeAll(async () => { t = await createTestContext(); });
afterAll(() => t.close());

describe("outbox: cuarentena", () => {
  it("tras N fallos pasa a cuarentena, avisa y se reprocesa cuando el consumidor ya funciona", async () => {
    await t.c.dispatcher.drain();
    const outbox = new OutboxDispatcher(t.c.db, 3);
    let broken = true;
    let handled = 0;
    outbox.on("EventPublished", "test.fragil", async () => {
      if (broken) throw new Error("consumidor roto");
      handled += 1;
    });
    const id = await publish(t.c.db, "EventPublished", { eventId: randomUUID() });
    const retryNow = () => t.c.db.query(`UPDATE platform.outbox SET available_at = now() WHERE id = $1`, [id]);

    for (let i = 0; i < 3; i++) { await outbox.runOnce(10); await retryNow(); }
    const b = await outbox.backlog();
    expect(b).toMatchObject({ pending: 0, oldestPendingSeconds: null, dead: 1 });
    expect(await outbox.runOnce(10)).toBe(0);
    const [dead] = await outbox.dead();
    expect(dead).toMatchObject({ id, type: "EventPublished", attempts: 3, lastError: "Error: consumidor roto" });
    expect((await t.c.heartbeat.readiness()).problems).not.toContain("outbox.stuck");

    const ops = await t.c.quality.checkOperational();
    expect(ops.find((o) => o.key === "outbox_dead")).toMatchObject({ breached: true, observed: 1 });

    broken = false;
    expect(await outbox.replayDead([id])).toBe(1);
    expect(await outbox.runOnce(10)).toBe(1);
    expect(handled).toBe(1);
    expect(await outbox.backlog()).toMatchObject({ pending: 0, dead: 0 });
  });
});
