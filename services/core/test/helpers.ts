import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { v7 } from "uuid";
import { buildContainer, type Container } from "../src/container.js";
import { buildApp } from "../src/http/app.js";
import { LogPushSender, type PushSender } from "../src/modules/alert/index.js";
import { loadEnv } from "../src/platform/config.js";
import { createPool } from "../src/platform/db.js";
import { migrate } from "../src/platform/migrate.js";
import { MIGRATIONS_DIR } from "../src/platform/paths.js";

export const TEST_DB_URL = process.env["TEST_DATABASE_URL"] ?? "postgres://dizaster:dizaster@localhost:5432/dizaster_test";
const SCHEMAS = ["platform", "identity", "social", "report", "event", "verification", "ingestion", "media", "geo", "alert", "cost"];

export async function resetDatabase(): Promise<void> {
  const db = createPool(TEST_DB_URL);
  try {
    for (const s of SCHEMAS) await db.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);
    await migrate(db, MIGRATIONS_DIR);
  } finally {
    await db.end();
  }
}

export interface TestContext {
  c: Container;
  app: FastifyInstance;
  close(): Promise<void>;
}

export async function createTestContext(opts: { push?: PushSender } = {}): Promise<TestContext> {
  await resetDatabase();
  const env = loadEnv({
    NODE_ENV: "test",
    DATABASE_URL: TEST_DB_URL,
    AUTH_JWT_SECRET: "test-secret-test-secret-test-secret-000",
    DEV_AUTH_ENABLED: "true",
    REPORTS_PER_HOUR_LIMIT: "5",
    STORAGE_DRIVER: "local",
    STORAGE_LOCAL_DIR: mkdtempSync(join(tmpdir(), "dizaster-storage-")),
    MEDIA_UPLOADS_PER_HOUR_LIMIT: "6",
  });
  const c = buildContainer(env, { push: opts.push ?? new LogPushSender(() => undefined) });
  await c.ingestion.syncRegistry(c.ref.sources);
  const app = await buildApp(c);
  return { c, app, close: async () => { await app.close(); await c.db.end(); } };
}

export interface TestUser { token: string; userId: string; profileId: string; deviceId: string }

/** Usuario de prueba con dispositivo. `ageHours` retrocede la creación (las cuentas nuevas pesan la mitad). */
export async function createUser(t: TestContext, handle: string, ageHours = 72): Promise<TestUser> {
  const res = await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle, platform: "ANDROID" } });
  const body = res.json() as TestUser;
  await t.c.db.query(`UPDATE identity.users SET created_at = now() - make_interval(hours => $2) WHERE id = $1`, [body.userId, ageHours]);
  return body;
}

export const LIMA = { lat: -12.0464, lng: -77.0428 };

/** Desplaza un punto `north` y `east` metros (aprox.). */
export function offset(p: { lat: number; lng: number }, northM: number, eastM = 0) {
  return { lat: p.lat + northM / 111_320, lng: p.lng + eastM / (111_320 * Math.cos((p.lat * Math.PI) / 180)) };
}

export function reportBody(
  user: TestUser,
  opts: {
    category?: string; pin?: { lat: number; lng: number }; fix?: { lat: number; lng: number }; accuracyM?: number;
    attestation?: string | null; assertion?: "OCCURRING" | "NOT_OCCURRING"; targetEventId?: string; text?: string;
    capturedAt?: Date; capturedOffline?: boolean; mock?: boolean; clientReportId?: string;
  } = {},
) {
  const now = opts.capturedAt ?? new Date();
  const pin = opts.pin ?? LIMA;
  const fix = opts.fix ?? pin;
  return {
    clientReportId: opts.clientReportId ?? v7(),
    categoryCode: opts.category ?? "accident.traffic",
    assertion: opts.assertion ?? "OCCURRING",
    ...(opts.text ? { text: opts.text } : {}),
    pin,
    presence: {
      fix: { ...fix, accuracyM: opts.accuracyM ?? 8, fixTime: now.toISOString(), provider: "GNSS" },
      mockLocation: opts.mock ?? false,
      attestationToken: opts.attestation === undefined ? "dev-genuine" : opts.attestation,
      recentFixes: [],
      deviceClock: new Date().toISOString(),
    },
    capturedAt: now.toISOString(),
    capturedOffline: opts.capturedOffline ?? false,
    deviceId: user.deviceId,
    ...(opts.targetEventId ? { targetEventId: opts.targetEventId } : {}),
  };
}

export async function submit(t: TestContext, user: TestUser, body: object) {
  const res = await t.app.inject({ method: "POST", url: "/v1/reports", headers: { authorization: `Bearer ${user.token}` }, payload: body });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> & { outcome: string; eventId?: string; postId?: string; reportId?: string } };
}

/** Carga el índice geográfico de prueba (subconjunto real de Lima/Callao, Natural Earth Tokio) con el manifiesto real. */
export async function seedGeoFixtures(t: TestContext): Promise<void> {
  const { importDataset, loadManifest } = await import("../src/modules/geo/index.js");
  const { defaultDataDir } = await import("../src/platform/paths.js");
  const { readFileSync } = await import("node:fs");
  const manifest = loadManifest(defaultDataDir());
  for (const spec of manifest.datasets) {
    const file = new URL(`./fixtures/geo/${spec.id}.geojson`, import.meta.url);
    await importDataset(t.c.db, manifest, spec, readFileSync(file), { verifyHash: false });
  }
}
