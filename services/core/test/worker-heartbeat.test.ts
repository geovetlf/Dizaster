import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HeartbeatService } from "../src/platform/heartbeat.js";
import { createTestContext, type TestContext } from "./helpers.js";

// Latido del worker y /health/ready (ADR 0187). NO AI REQUIRED.
let t: TestContext;
beforeAll(async () => { t = await createTestContext(); });
afterAll(async () => { await t.close(); });

const ready = async () => { const r = await t.app.inject({ url: "/health/ready" }); return { code: r.statusCode, body: r.json() as { ready: boolean; problems: string[]; roles: Record<string, number | null> } }; };

describe("latido del worker", () => {
  it("sin latidos no está listo; con los tres roles al día sí", async () => {
    await t.c.db.query(`DELETE FROM platform.worker_heartbeats`);
    const before = await ready();
    expect(before.code).toBe(503);
    expect(before.body.problems).toEqual(expect.arrayContaining(["worker.urgent.never", "worker.normal.never", "worker.maintenance.never"]));
    await t.c.db.query(`UPDATE platform.outbox SET processed_at = now() WHERE processed_at IS NULL`);
    for (const role of ["urgent", "normal", "maintenance"] as const) await t.c.heartbeat.beat("w1", role);
    const after = await ready();
    expect(after.code).toBe(200);
    expect(after.body.ready).toBe(true);
    expect(after.body.roles.urgent).toBe(0);
  });

  it("un rol que deja de latir o un outbox parado lo ponen en 503; la instancia se juzga por sus roles", async () => {
    await t.c.db.query(`UPDATE platform.worker_heartbeats SET beat_at = now() - interval '10 minutes' WHERE role = 'normal'`);
    expect((await ready()).body.problems).toEqual(["worker.normal.stale"]);
    expect(await t.c.heartbeat.instanceAlive("w1", ["urgent", "maintenance"])).toBe(true);
    expect(await t.c.heartbeat.instanceAlive("w1", ["urgent", "normal"])).toBe(false);
    await t.c.heartbeat.beat("w1", "normal");

    await t.c.db.query(
      `INSERT INTO platform.outbox (id, type, payload, lane, occurred_at, available_at)
       VALUES (gen_random_uuid(), 'Test', '{}', 'normal', now() - interval '1 hour', now() - interval '1 hour')`,
    );
    const stuck = await ready();
    expect(stuck.code).toBe(503);
    expect(stuck.body.problems).toEqual(["outbox.stuck"]);
    await t.c.db.query(`UPDATE platform.outbox SET processed_at = now() WHERE type = 'Test'`);
  });

  it("borra instancias viejas", async () => {
    await t.c.heartbeat.beat("old", "urgent");
    await t.c.db.query(`UPDATE platform.worker_heartbeats SET beat_at = now() - interval '2 days' WHERE instance_id = 'old'`);
    expect(await new HeartbeatService(t.c.db).prune()).toBe(1);
  });
});
