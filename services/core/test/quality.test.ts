import type { QualityReport } from "@dizaster/contracts";
import { v7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LogPushSender, budgetAlertText } from "../src/modules/alert/index.js";
import { histogramPercentile, latencyMetric } from "../src/platform/metrics.js";
import { createTestContext, createUser, type TestContext } from "./helpers.js";

describe("histograma de latencia", () => {
  it("clasifica por tramos y estima percentiles con el techo del tramo", () => {
    expect(latencyMetric(3)).toBe("latency_le_25");
    expect(latencyMetric(25)).toBe("latency_le_25");
    expect(latencyMetric(250)).toBe("latency_le_300");
    expect(latencyMetric(9000)).toBe("latency_gt_5000");
    const h = new Map([["latency_le_25", 90], ["latency_le_300", 8], ["latency_gt_5000", 2]]);
    expect(histogramPercentile(h, 0.5)).toBe(25);
    expect(histogramPercentile(h, 0.95)).toBe(300);
    expect(histogramPercentile(h, 0.99)).toBe(Number.POSITIVE_INFINITY);
    expect(histogramPercentile(new Map(), 0.95)).toBeNull();
  });

  it("el aviso de presupuesto se traduce y dice si la función se detuvo", () => {
    const b = { key: "ai", threshold: 80, spentUsd: 8, limitUsd: 10 };
    expect(budgetAlertText("es", b)).toEqual({ title: "Presupuesto ai al 80%", body: "Gastado US$ 8.00 de US$ 10.00." });
    expect(budgetAlertText("en", { ...b, threshold: 100, spentUsd: 10.5 }).body).toBe("Spent US$ 10.50 of US$ 10.00. The feature has stopped.");
  });
});

describe("tablero de calidad", () => {
  let t: TestContext;
  let adminToken: string;
  let adminUserId: string;
  const push = new LogPushSender(() => undefined);
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const report = async (days = 7): Promise<QualityReport> => {
    const res = await t.app.inject({ url: `/v1/admin/quality?days=${days}`, headers: auth(adminToken) });
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as QualityReport;
  };

  beforeAll(async () => {
    t = await createTestContext({ push });
    const admin = await createUser(t, "calidad");
    await t.c.identity.grantRole(admin.userId, "admin");
    adminUserId = admin.userId;
    adminToken = (await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle: "calidad", platform: "ANDROID", deviceId: admin.deviceId } })).json().token;
  });
  afterAll(async () => t.close());

  it("solo administración lo ve y valida el periodo", async () => {
    const u = await createUser(t, "curiosa");
    expect((await t.app.inject({ url: "/v1/admin/quality", headers: auth(u.token) })).statusCode).toBe(403);
    expect((await t.app.inject({ url: "/v1/admin/quality" })).statusCode).toBe(401);
    expect((await t.app.inject({ url: "/v1/admin/quality?days=0", headers: auth(adminToken) })).statusCode).toBe(400);
  });

  it("mide la latencia de la API y juzga los objetivos", async () => {
    for (let i = 0; i < 5; i++) await t.app.inject({ url: "/v1/config" });
    const r = await report();
    expect(r.period.days).toBe(7);
    expect(r.api.requests).toBeGreaterThanOrEqual(5);
    expect(r.api.p95Ms).not.toBeNull();
    expect(r.slos.map((s) => s.key)).toEqual(["api_p95", "urgent_chain_p95", "moderation_oldest_open"]);
    expect(r.slos.find((s) => s.key === "api_p95")!.ok).toBe(true);
    // Sin avisos críticos todavía no hay forma de juzgar la cadena urgente.
    expect(r.slos.find((s) => s.key === "urgent_chain_p95")!.ok).toBeNull();
    expect(r.slos.find((s) => s.key === "moderation_oldest_open")).toMatchObject({ observed: 0, ok: true });
  });

  it("junta ingesta, avisos y moderación", async () => {
    const db = t.c.db;
    const source = (await db.query<{ id: string }>(`SELECT id FROM ingestion.sources LIMIT 1`)).rows[0]!.id;
    await db.query(`INSERT INTO ingestion.runs (id, source_id, lane, started_at, finished_at, status) VALUES ($1, $3, 'URGENT', now(), now(), 'OK'), ($2, $3, 'URGENT', now(), now(), 'FAILED')`, [v7(), v7(), source]);
    await db.query(
      `INSERT INTO ingestion.external_items (id, source_id, external_id, content_hash, lane, published_at, fetched_at, normalized, status)
       VALUES ($1, $2, 'q-1', 'h', 'URGENT', now() - interval '40 seconds', now(), '{}', 'NEW')`,
      [v7(), source],
    );
    const alertId = v7();
    await db.query(
      `INSERT INTO alert.alerts (id, event_id, kind, dedup_key, category_code, severity, public_state, critical, created_at)
       VALUES ($1, $2, 'NEW_EVENT', 'q:1', 'FLOOD', 5, 'OFFICIALLY_CONFIRMED', true, now() - interval '10 seconds')`,
      [alertId, v7()],
    );
    await db.query(
      `INSERT INTO alert.notifications (id, alert_id, profile_id, user_id, match, title, body, status, pushed_at)
       VALUES ($1, $2, $3, $4, 'CATEGORY', 't', 'b', 'SENT', now())`,
      [v7(), alertId, v7(), v7()],
    );
    await db.query(`INSERT INTO moderation.cases (id, target_type, target_id, opened_at) VALUES ($1, 'POST', $2, now() - interval '30 hours')`, [v7(), v7()]);

    const r = await report();
    expect(r.ingestion).toMatchObject({ runs: 2, failedRuns: 1, failureRate: 0.5, urgentItems: 1 });
    expect(r.ingestion.urgentLagP95Seconds).toBeCloseTo(40, 0);
    expect(r.alerts).toMatchObject({ alerts: 1, critical: 1, notifications: { SENT: 1 } });
    expect(r.alerts.criticalPushP95Seconds).toBeCloseTo(10, 0);
    const chain = r.slos.find((s) => s.key === "urgent_chain_p95")!;
    expect(chain.observed).toBeCloseTo(50, 0);
    expect(chain.ok).toBe(true);
    expect(r.moderation.openCases).toBe(1);
    expect(r.slos.find((s) => s.key === "moderation_oldest_open")!.ok).toBe(false);
    // Ningún dato personal en el tablero.
    expect(JSON.stringify(r)).not.toContain(adminUserId);
  });

  it("avisa por push a administración cuando un presupuesto cruza un umbral, en su idioma", async () => {
    const dev = (await t.c.db.query<{ id: string }>(`SELECT id FROM identity.devices WHERE user_id = $1`, [adminUserId])).rows[0]!.id;
    expect((await t.app.inject({ method: "PUT", url: `/v1/devices/${dev}/push-token`, headers: auth(adminToken), payload: { provider: "FCM", token: `fcm-admin-${"x".repeat(20)}` } })).statusCode).toBe(204);
    const prefs = (await t.app.inject({ url: "/v1/me/alert-preferences", headers: auth(adminToken) })).json();
    expect((await t.app.inject({ method: "PUT", url: "/v1/me/alert-preferences", headers: auth(adminToken), payload: { ...prefs, lang: "en" } })).statusCode).toBe(200);
    await t.c.cost.record("sms", 0.05, { provider: "sms-x", units: 1 });
    await t.c.dispatcher.drain();
    const sent = push.sent.filter((m) => m.url === "dizaster://admin-cost");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ title: "Budget sms at 100%", groupKey: "budget:sms", critical: false });
    // Un aviso operativo no entra al historial de alertas públicas.
    expect((await t.c.db.query(`SELECT 1 FROM alert.notifications WHERE user_id = $1`, [adminUserId])).rowCount).toBe(0);
  });

  it("alerta operativa: avisa al incumplirse y al recuperarse, no en cada chequeo (ADR 0130)", async () => {
    const id = v7();
    // Un evento interno retenido 10 min (con reintento a futuro, para que el worker de prueba no lo tome).
    await t.c.db.query(
      `INSERT INTO platform.outbox (id, type, payload, lane, occurred_at, available_at) VALUES ($1, 'ReportSubmitted', '{}', 'normal', now() - interval '10 minutes', now() + interval '1 hour')`, [id]);
    const outbox = <T extends { key: string }>(x: T[]) => x.filter((a) => a.key === "outbox_oldest_pending");
    const first = await t.c.quality.checkOperational();
    expect(outbox(first)).toMatchObject([{ breached: true, target: 300, unit: "s" }]);
    expect(outbox(first)[0]!.observed).toBeGreaterThanOrEqual(600);
    const sent = push.sent.filter((m) => m.groupKey === "ops:outbox_oldest_pending");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ title: "Target missed: Pending internal events", url: "dizaster://admin-quality", critical: false });
    expect(outbox(await t.c.quality.checkOperational())).toEqual([]);
    await t.c.db.query(`UPDATE platform.outbox SET processed_at = now() WHERE id = $1`, [id]);
    expect(outbox(await t.c.quality.checkOperational())).toMatchObject([{ breached: false }]);
    expect(push.sent.filter((m) => m.groupKey === "ops:outbox_oldest_pending").map((m) => m.title)).toEqual([
      "Target missed: Pending internal events", "Target recovered: Pending internal events",
    ]);
  });
});
