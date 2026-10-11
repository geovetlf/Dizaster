import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadEnv } from "../src/platform/config.js";
import { createTestContext, createUser, LIMA, offset, reportBody, submit, type TestContext } from "./helpers.js";

/**
 * D1 (decisión del propietario, ADR 0315 y 0318): la ubicación precisa del teléfono se guarda 7 días en categorías
 * sensibles (configurable) y 30 en el resto. Al vencer se borra y solo queda la celda H3 r7.
 */
const DAY = 24 * 3600_000;
const repoData = join(import.meta.dirname, "..", "..", "..", "data");

async function evidence(t: TestContext, reportId: string) {
  return (await t.c.db.query<{ days: number; precise: boolean; generalized: boolean }>(
    `SELECT round(extract(epoch FROM pe.expires_at - r.received_at) / 86400)::int AS days,
            (pe.device_fix_enc IS NOT NULL OR pe.device_fix IS NOT NULL) AS precise, pe.generalized_at IS NOT NULL AS generalized
       FROM report.presence_evidence pe JOIN report.reports r ON r.id = pe.report_id WHERE pe.report_id = $1`, [reportId],
  )).rows[0]!;
}

describe("retención de la ubicación precisa por sensibilidad (D1)", () => {
  let t: TestContext;
  beforeAll(async () => { t = await createTestContext(); });
  afterAll(() => t.close());

  const report = async (handle: string, category: string, north: number) => {
    const u = await createUser(t, handle);
    const r = await submit(t, u, reportBody(u, { category, pin: offset(LIMA, north, 5000) }));
    expect(r.body.reportId).toBeTruthy();
    return r.body.reportId as string;
  };

  it("7 días en SENSITIVE y HIGHLY_SENSITIVE, 30 en el resto; vence cada uno a su plazo", async () => {
    const theft = await report("d1_theft", "crime.theft", 1000);
    const violence = await report("d1_violence", "crime.violence", 4000);
    const traffic = await report("d1_traffic", "accident.traffic", 7000);
    expect((await evidence(t, theft)).days).toBe(7);
    expect((await evidence(t, violence)).days).toBe(7);
    expect((await evidence(t, traffic)).days).toBe(30);

    await t.c.reports.generalizeExpiredPresence(new Date(Date.now() + 6 * DAY));
    expect((await evidence(t, theft)).precise).toBe(true);

    await t.c.reports.generalizeExpiredPresence(new Date(Date.now() + 8 * DAY));
    expect(await evidence(t, theft)).toMatchObject({ precise: false, generalized: true });
    expect(await evidence(t, violence)).toMatchObject({ precise: false, generalized: true });
    expect(await evidence(t, traffic)).toMatchObject({ precise: true, generalized: false });

    await t.c.reports.generalizeExpiredPresence(new Date(Date.now() + 31 * DAY));
    expect(await evidence(t, traffic)).toMatchObject({ precise: false, generalized: true });
    // La celda generalizada sigue para estadística y antiabuso.
    expect((await t.c.db.query(`SELECT fix_h3_r7 FROM report.presence_evidence WHERE report_id = $1`, [theft])).rows[0].fix_h3_r7).toBeTruthy();
  });

  it("las filas guardadas con el plazo anterior (30 días) se ajustan al nuevo y se borran a los 7", async () => {
    const id = await report("d1_legacy", "crime.robbery", 10000);
    await t.c.db.query(`UPDATE report.presence_evidence pe SET expires_at = r.received_at + interval '30 days' FROM report.reports r WHERE r.id = pe.report_id AND pe.report_id = $1`, [id]);
    await t.c.reports.generalizeExpiredPresence(new Date(Date.now() + 2 * DAY));
    expect(await evidence(t, id)).toMatchObject({ days: 7, precise: true });
    await t.c.reports.generalizeExpiredPresence(new Date(Date.now() + 8 * DAY));
    expect(await evidence(t, id)).toMatchObject({ precise: false, generalized: true });
  });

  it("la ubicación precisa no sale en el evento público ni en la publicación", async () => {
    const u = await createUser(t, "d1_public");
    const pin = offset(LIMA, 13000, 5000);
    const r = (await submit(t, u, reportBody(u, { category: "crime.theft", pin }))).body;
    const exact = [pin.lat.toFixed(5), pin.lng.toFixed(5)];
    const urls = [`/v1/events/${r.eventId}`, `/v1/events/${r.eventId}/posts`, `/v1/events/${r.eventId}/timeline`, `/v1/posts/${r.postId}`,
      `/v1/events?bbox=-78,-13,-76,-11&zoom=16`];
    for (const url of urls) {
      const res = await t.app.inject({ url });
      expect(res.statusCode, url).toBe(200);
      for (const x of exact) expect(res.body, url).not.toContain(x);
    }
  });
});

describe("configuración de D1", () => {
  const base = { NODE_ENV: "test", DATABASE_URL: "postgres://x", AUTH_JWT_SECRET: "test-secret-test-secret-test-secret-000" };

  it("el plazo sensible es 7 por defecto y no puede superar el general", () => {
    expect(loadEnv(base).SENSITIVE_PRESENCE_RETENTION_DAYS).toBe(7);
    expect(loadEnv({ ...base, SENSITIVE_PRESENCE_RETENTION_DAYS: "3" }).SENSITIVE_PRESENCE_RETENTION_DAYS).toBe(3);
    expect(() => loadEnv({ ...base, SENSITIVE_PRESENCE_RETENTION_DAYS: "40" })).toThrow(/no puede superar/);
    expect(() => loadEnv({ ...base, PRESENCE_RETENTION_DAYS: "5" })).toThrow(/no puede superar/);
  });

  describe("plazo por categoría en los datos", () => {
    let t: TestContext;
    beforeAll(async () => {
      const dir = mkdtempSync(join(tmpdir(), "dz-data-"));
      cpSync(repoData, dir, { recursive: true });
      const file = join(dir, "categories", "categories.json");
      const catalog = JSON.parse(readFileSync(file, "utf8")) as { categories: Array<Record<string, unknown>> };
      for (const c of catalog.categories) {
        if (c["code"] === "crime.theft") c["presenceRetentionDays"] = 2;
        if (c["code"] === "crime.vandalism") c["presenceRetentionDays"] = 60; // intenta alargar: no puede
        if (c["code"] === "accident.traffic") c["presenceRetentionDays"] = 90;
      }
      writeFileSync(file, JSON.stringify(catalog));
      t = await createTestContext({ env: { DATA_DIR: dir } });
    });
    afterAll(() => t.close());

    it("solo acorta el plazo que toca por sensibilidad", () => {
      expect(t.c.reports.presenceRetentionDays("crime.theft")).toBe(2);
      expect(t.c.reports.presenceRetentionDays("crime.vandalism")).toBe(7);
      expect(t.c.reports.presenceRetentionDays("crime.robbery")).toBe(7);
      expect(t.c.reports.presenceRetentionDays("accident.traffic")).toBe(30);
    });
  });
});
