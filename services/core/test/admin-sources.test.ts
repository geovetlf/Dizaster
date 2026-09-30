import type { AdminSourcesResponse } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sourceHealth } from "@dizaster/contracts";
import { createTestContext, createUser, type TestContext, type TestUser } from "./helpers.js";

// Salud y pausa/reanudación de fuentes desde administración (ADR 0162). NO AI REQUIRED.
let t: TestContext;
const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });
async function asRole(handle: string, role: "moderator" | "operator"): Promise<TestUser> {
  const u = await createUser(t, handle);
  await t.c.identity.grantRole(u.userId, role);
  const token = (await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle, platform: "ANDROID", deviceId: u.deviceId } })).json().token as string;
  return { ...u, token };
}
const list = async (u: TestUser) => (await t.app.inject({ url: "/v1/admin/sources", headers: auth(u) })).json() as AdminSourcesResponse;

beforeAll(async () => {
  t = await createTestContext();
  await t.c.ingestion.setSourceStatus("usgs-earthquakes", "ACTIVE");
});
afterAll(() => t.close());

describe("clasificación de salud", () => {
  const now = new Date("2026-09-30T12:00:00Z");
  it("inactiva, caída, fallando, bien, sin datos", () => {
    expect(sourceHealth({ status: "PAUSED", consecutiveFailures: 5, breakerOpenUntil: null, lastRunAt: null }, now)).toBe("IDLE");
    expect(sourceHealth({ status: "ACTIVE", consecutiveFailures: 3, breakerOpenUntil: new Date("2026-09-30T12:05:00Z"), lastRunAt: now }, now)).toBe("DOWN");
    expect(sourceHealth({ status: "ACTIVE", consecutiveFailures: 1, breakerOpenUntil: null, lastRunAt: now }, now)).toBe("FAILING");
    expect(sourceHealth({ status: "ACTIVE", consecutiveFailures: 0, breakerOpenUntil: null, lastRunAt: now }, now)).toBe("OK");
    expect(sourceHealth({ status: "ACTIVE", consecutiveFailures: 0, breakerOpenUntil: null, lastRunAt: null }, now)).toBe("UNKNOWN");
  });
});

describe("fuentes desde administración", () => {
  it("operación ve la salud, pausa y reanuda con motivo; queda registrado", async () => {
    const op = await asRole("operadora_fuentes", "operator");
    const mod = await asRole("mod_fuentes", "moderator");
    const src = (await t.c.db.query<{ id: string }>(`SELECT id FROM ingestion.sources WHERE key = 'usgs-earthquakes'`)).rows[0]!;
    await t.c.db.query(
      `INSERT INTO ingestion.source_state (source_id, consecutive_failures, open_until) VALUES ($1, 3, now() + interval '10 minutes')
       ON CONFLICT (source_id) DO UPDATE SET consecutive_failures = 3, open_until = now() + interval '10 minutes'`, [src.id],
    );
    await t.c.db.query(
      `INSERT INTO ingestion.runs (id, source_id, lane, started_at, finished_at, status, error) VALUES (gen_random_uuid(), $1, 'URGENT', now(), now(), 'FAILED', 'HTTP 503')`, [src.id],
    );

    expect((await t.app.inject({ url: "/v1/admin/sources", headers: auth(mod) })).statusCode).toBe(403);
    const usgs = (await list(op)).sources.find((s) => s.key === "usgs-earthquakes")!;
    expect(usgs).toMatchObject({ status: "ACTIVE", health: "DOWN", consecutiveFailures: 3, lastError: "HTTP 503", runsFailed: 1, urgentCapable: true });
    expect(usgs.breakerOpenUntil).toBeTruthy();

    const post = (u: TestUser, to: string, reason = "Mantenimiento del proveedor") =>
      t.app.inject({ method: "POST", url: "/v1/admin/sources/usgs-earthquakes/status", headers: auth(u), payload: { to, reason } });
    expect((await post(mod, "PAUSED")).statusCode).toBe(403);
    expect((await post(op, "PAUSED")).statusCode).toBe(204);
    expect((await post(op, "PAUSED")).statusCode).toBe(409);
    const paused = (await list(op)).sources.find((s) => s.key === "usgs-earthquakes")!;
    expect(paused).toMatchObject({ status: "PAUSED", health: "IDLE", lastStatusChange: { from: "ACTIVE", to: "PAUSED", reason: "Mantenimiento del proveedor" } });

    // Reanudar cierra el breaker: se consulta en el siguiente ciclo.
    expect((await post(op, "ACTIVE", "Proveedor de vuelta")).statusCode).toBe(204);
    const back = (await list(op)).sources.find((s) => s.key === "usgs-earthquakes")!;
    expect(back).toMatchObject({ status: "ACTIVE", consecutiveFailures: 0, breakerOpenUntil: null, lastError: null });

    // Una fuente que nunca se activó no se enciende desde la app.
    const planned = (await t.c.db.query<{ key: string }>(`SELECT key FROM ingestion.sources WHERE status IN ('PLANNED','RESEARCH') LIMIT 1`)).rows[0];
    if (planned) {
      const r = await t.app.inject({ method: "POST", url: `/v1/admin/sources/${planned.key}/status`, headers: auth(op), payload: { to: "ACTIVE", reason: "probar" } });
      expect(r.statusCode).toBe(409);
    }
    const log = await t.c.db.query(`SELECT to_status FROM ingestion.source_status_log WHERE source_id = $1 ORDER BY at`, [src.id]);
    expect(log.rows.map((r) => r.to_status)).toEqual(["PAUSED", "ACTIVE"]);
  });
});
