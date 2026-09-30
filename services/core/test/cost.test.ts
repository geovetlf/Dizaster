import type { CostDashboard } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { routeGroup } from "../src/http/app.js";
import { Meter, type UsageEntry } from "../src/platform/metrics.js";
import { createTestContext, createUser, LIMA, seedGeoFixtures, type TestContext } from "./helpers.js";

describe("Meter", () => {
  it("agrega en memoria y conserva lo medido si el volcado falla", async () => {
    let now = new Date("2026-09-29T23:59:00Z");
    const meter = new Meter(() => now);
    meter.add("http", "requests", 1, "events");
    meter.add("http", "requests", 2, "events");
    meter.add("http", "requests", 0, "events");
    now = new Date("2026-09-30T00:01:00Z");
    meter.add("http", "requests", 1, "events");

    const failing = { persistUsage: async () => { throw new Error("db caída"); } };
    await expect(meter.flush(failing)).rejects.toThrow("db caída");
    const got: UsageEntry[] = [];
    expect(await meter.flush({ persistUsage: async (e) => { got.push(...e); } })).toBe(2);
    expect(got.map((e) => [e.day, e.units])).toEqual([["2026-09-29", 3], ["2026-09-30", 1]]);
    expect(await meter.flush({ persistUsage: async () => undefined })).toBe(0);
  });

  it("agrupa rutas por su primer segmento", () => {
    expect(routeGroup("/v1/events/:id")).toBe("events");
    expect(routeGroup("/v1/me/notifications")).toBe("me");
    expect(routeGroup("/health")).toBe("health");
    expect(routeGroup(undefined)).toBe("unmatched");
  });
});

describe("Cost Optimization Layer", () => {
  let t: TestContext;
  let adminToken: string;
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const dashboard = async (days = 7) => {
    const res = await t.app.inject({ url: `/v1/admin/cost?days=${days}`, headers: auth(adminToken) });
    expect(res.statusCode).toBe(200);
    return res.json() as CostDashboard;
  };

  beforeAll(async () => {
    t = await createTestContext();
    await seedGeoFixtures(t);
    const admin = await createUser(t, "operadora");
    await t.c.identity.grantRole(admin.userId, "admin");
    adminToken = (await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle: "operadora", platform: "ANDROID", deviceId: admin.deviceId } })).json().token;
  });
  afterAll(() => t.close());

  it("solo administración ve el tablero y cambia presupuestos o kill switches", async () => {
    const u = await createUser(t, "curioso");
    expect((await t.app.inject({ url: "/v1/admin/cost", headers: auth(u.token) })).statusCode).toBe(403);
    expect((await t.app.inject({ url: "/v1/admin/cost" })).statusCode).toBe(401);
    expect((await t.app.inject({ method: "PUT", url: "/v1/admin/kill-switches/ai", headers: auth(u.token), payload: { killed: false } })).statusCode).toBe(403);
    expect((await t.app.inject({ url: "/v1/me/account", headers: auth(adminToken) })).json()).toMatchObject({ roles: ["user", "admin"], ageConfirmed: true, minAge: 16 });
    expect((await t.app.inject({ url: "/v1/me/account", headers: auth(u.token) })).json()).toMatchObject({ roles: ["user"] });
  });

  it("mide peticiones por grupo de rutas y consultas geográficas", async () => {
    for (let i = 0; i < 3; i++) await t.app.inject({ url: "/v1/reference/categories" });
    await t.app.inject({ url: "/v1/nada" });
    await t.c.geo.resolveAdmin(t.c.db, LIMA);
    await t.c.geo.resolveAdmin(t.c.db, LIMA);
    const d = await dashboard();
    const http = d.modules.find((m) => m.module === "http")!;
    expect(http.metrics.find((m) => m.metric === "requests" && m.provider === "reference")!.units).toBe(3);
    expect(http.metrics.find((m) => m.metric === "requests" && m.provider === "unmatched")!.units).toBe(1);
    expect(http.metrics.find((m) => m.metric === "response_bytes" && m.provider === "reference")!.units).toBeGreaterThan(1000);
    const geo = d.modules.find((m) => m.module === "geo")!.metrics;
    expect(geo.find((m) => m.provider === "index")!.units).toBe(1);
    expect(geo.find((m) => m.provider === "cache")!.units).toBe(1);
    expect(d.daily).toHaveLength(7);
    expect(d.daily[6]!.requests).toBeGreaterThanOrEqual(4);
    expect(d.activeUsers).toBeGreaterThanOrEqual(2);
    expect(d.gauges.databaseBytes).toBeGreaterThan(0);
    expect(d.estimatedUsd.fixed).toBeNull();
    expect(d.costPer1000ActiveUsers).not.toBeNull();
  });

  it("las funciones de pago empiezan apagadas y sin presupuesto; el kill switch es remoto", async () => {
    expect(await t.c.cost.check("ai", 0.01)).toBe(false);
    expect(await t.c.cost.check("desconocida", 0)).toBe(false);
    expect((await t.app.inject({ url: "/v1/config" })).json().killSwitches).toEqual({ ai: true, translation: true, sms: true, "media-upload": false, video: false });
    const res = await t.app.inject({ method: "PUT", url: "/v1/admin/kill-switches/ai", headers: auth(adminToken), payload: { killed: false, reason: "Piloto aprobado" } });
    expect(res.json()).toMatchObject({ feature: "ai", killed: false, reason: "Piloto aprobado" });
    expect((await t.app.inject({ url: "/v1/config" })).json().killSwitches.ai).toBe(false);
    // Encendida pero con presupuesto 0: sigue sin poder gastar.
    expect(await t.c.cost.check("ai", 0.01)).toBe(false);
  });

  it("presupuesto: avisa una vez al 50, 80 y 100 % y deniega al agotarse", async () => {
    const put = await t.app.inject({ method: "PUT", url: "/v1/admin/cost/budgets/ai", headers: auth(adminToken), payload: { period: "DAILY", limitUsd: 10 } });
    expect(put.json()).toMatchObject({ key: "ai", period: "DAILY", limitUsd: 10, spentUsd: 0, killed: false });
    expect((await t.app.inject({ method: "PUT", url: "/v1/admin/cost/budgets/ai", headers: auth(adminToken), payload: { period: "YEARLY", limitUsd: 1 } })).statusCode).toBe(400);

    const thresholds = async () =>
      (await t.c.db.query<{ payload: { threshold: number } }>(`SELECT payload FROM platform.outbox WHERE type = 'BudgetThresholdReached' ORDER BY occurred_at`)).rows.map((r) => r.payload.threshold);
    expect(await t.c.cost.check("ai", 4)).toBe(true);
    await t.c.cost.record("ai", 4, { provider: "modelo-x", units: 1000 });
    expect(await thresholds()).toEqual([]);
    await t.c.cost.record("ai", 1.5, { provider: "modelo-x", units: 400 });
    expect(await thresholds()).toEqual([50]);
    await t.c.cost.record("ai", 3, { provider: "modelo-x", units: 800 });
    expect(await thresholds()).toEqual([50, 80]);
    expect(await t.c.cost.check("ai", 2)).toBe(false);
    expect(await t.c.cost.check("ai", 1.5)).toBe(true);
    await t.c.cost.record("ai", 1.5, { provider: "modelo-x", units: 300 });
    await t.c.cost.record("ai", 0.5, { provider: "modelo-x", units: 100 });
    expect(await thresholds()).toEqual([50, 80, 100]);
    expect(await t.c.cost.check("ai", 0.01)).toBe(false);
    await t.c.dispatcher.runOnce(50);

    const d = await dashboard();
    expect(d.budgets.find((b) => b.key === "ai")).toMatchObject({ limitUsd: 10, spentUsd: 10.5, percent: 105 });
    expect(d.modules[0]).toMatchObject({ module: "ai", estimatedUsd: 10.5, metrics: [{ metric: "spend", provider: "modelo-x", units: 2600, estimatedUsd: 10.5 }] });
    expect(d.estimatedUsd.variable).toBeGreaterThanOrEqual(10.5);
  });

  it("un gasto sin presupuesto (tope 0) salta directo al 100 %", async () => {
    await t.c.cost.record("sms", 0.05, { provider: "sms-x", units: 1 });
    const rows = (await t.c.db.query<{ payload: { key: string; threshold: number } }>(`SELECT payload FROM platform.outbox WHERE type = 'BudgetThresholdReached' AND payload->>'key' = 'sms'`)).rows;
    expect(rows.map((r) => r.payload.threshold)).toEqual([100]);
    const d = await dashboard(1);
    expect(d.budgets.find((b) => b.key === "sms")).toMatchObject({ limitUsd: 0, percent: 100, killed: true });
  });

  it("el tablero muestra el uso de IA por capacidad y borrar la cuenta desvincula a la persona (ADR 0110)", async () => {
    const u = await createUser(t, "usa_ia");
    const base = { provider: "p1", model: "m1", fallback: false, latencyMs: 100, inputTokens: 10, outputTokens: 5, estimatedUsd: 0.002, subject: null };
    await t.c.cost.recordAiCall({ ...base, capability: "SUMMARIZE_INCIDENT", status: "OK", usd: 0.002, actorUserId: u.userId });
    await t.c.cost.recordAiCall({ ...base, capability: "SUMMARIZE_INCIDENT", status: "TIMEOUT", fallback: true, latencyMs: 300, inputTokens: 0, outputTokens: 0, usd: 0, actorUserId: u.userId });
    await t.c.cost.recordAiCall({ ...base, capability: "MODERATE_CONTENT", status: "OK", usd: 0.001, actorUserId: null });
    const ai = (await dashboard(1)).ai;
    expect(ai.find((r) => r.capability === "SUMMARIZE_INCIDENT")).toMatchObject({ provider: "p1", model: "m1", calls: 2, fallbacks: 1, inputTokens: 10, outputTokens: 5, usd: 0.002, avgLatencyMs: 200 });
    expect(ai.find((r) => r.capability === "MODERATE_CONTENT")).toMatchObject({ calls: 1, usd: 0.001 });

    expect((await t.app.inject({ method: "DELETE", url: "/v1/me", headers: auth(u.token), payload: { confirm: "DELETE" } })).statusCode).toBeLessThan(300);
    await t.c.dispatcher.drain();
    const left = await t.c.db.query(`SELECT 1 FROM cost.ai_calls WHERE actor_user_id = $1`, [u.userId]);
    expect(left.rowCount).toBe(0);
    expect((await dashboard(1)).ai.find((r) => r.capability === "SUMMARIZE_INCIDENT")!.calls).toBe(2);
  });
});
