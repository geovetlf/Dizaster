import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IngestionScheduler, type FetchResult, type HttpFetcher } from "../src/modules/ingestion/index.js";
import type { StorageProvider } from "../src/modules/media/index.js";
import { createTestContext, type TestContext } from "./helpers.js";

// Crudo de cada fuente para auditoría, con retención (ADR 0075). NO AI REQUIRED.
const body = readFileSync(new URL("./fixtures/usgs-summary.geojson", import.meta.url), "utf8");

class QueueFetcher implements HttpFetcher {
  next: FetchResult[] = [];
  async get(): Promise<FetchResult> { return this.next.shift() ?? { status: 304 }; }
}

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
  await t.c.ingestion.setSourceStatus("usgs-earthquakes", "ACTIVE");
});
afterAll(async () => { await t.close(); });

describe("crudo de las fuentes", () => {
  it("guarda la respuesta comprimida una sola vez, la enlaza a los ítems y la borra tras la retención", async () => {
    let now = new Date("2026-09-29T06:00:00Z");
    const fetcher = new QueueFetcher();
    const scheduler = new IngestionScheduler(t.c.db, t.c.ingestion, fetcher, { now: () => now }, {}, { storage: t.c.storage, retentionDays: 30 });
    fetcher.next = [{ status: 200, body }, { status: 200, body }];
    await scheduler.tick(); // URGENT + NORMAL con el mismo cuerpo

    const runs = await t.c.db.query<{ raw_ref: string }>(`SELECT raw_ref FROM ingestion.runs WHERE raw_ref IS NOT NULL`);
    expect(runs.rows).toHaveLength(2);
    expect(new Set(runs.rows.map((r) => r.raw_ref)).size).toBe(1); // idéntico → misma clave, un solo objeto
    const key = runs.rows[0]!.raw_ref;
    expect(key).toMatch(/^sources\/raw\/usgs-earthquakes\/2026-09-29\/.+\.json\.gz$/);
    expect(gunzipSync(await t.c.storage.get(key)).toString("utf8")).toBe(body);
    const items = await t.c.db.query<{ raw_ref: string }>(`SELECT raw_ref FROM ingestion.external_items`);
    expect(items.rows.length).toBeGreaterThan(0);
    expect(items.rows.every((r) => r.raw_ref === key)).toBe(true);
    // Privado: no se sirve por la ruta pública del almacenamiento de desarrollo.
    expect((await t.app.inject({ url: `/v1/dev-storage/${key}` })).statusCode).toBe(404);

    // Aún dentro de la retención: nada se borra.
    expect(await scheduler.applyRawRetention(new Date("2026-10-20T00:00:00Z"))).toEqual({ deleted: 0 });
    now = new Date("2026-11-05T00:00:00Z");
    expect(await scheduler.applyRawRetention(now)).toEqual({ deleted: 1 });
    expect(await t.c.storage.stat(key)).toBeNull();
    const left = await t.c.db.query(`SELECT 1 FROM ingestion.external_items WHERE raw_ref IS NOT NULL
                                     UNION ALL SELECT 1 FROM ingestion.runs WHERE raw_ref IS NOT NULL`);
    expect(left.rows).toHaveLength(0);
  });

  it("si el almacenamiento falla, la ingestión sigue sin crudo", async () => {
    const broken: StorageProvider = { ...t.c.storage, id: "broken", put: async () => { throw new Error("bucket caído"); } } as StorageProvider;
    const fetcher = new QueueFetcher();
    const now = new Date("2026-12-01T06:00:00Z");
    const scheduler = new IngestionScheduler(t.c.db, t.c.ingestion, fetcher, { now: () => now }, {}, { storage: broken, retentionDays: 30 });
    fetcher.next = [{ status: 200, body: body.replace("us7000pe01", "us7000pe99") }];
    const [run] = await scheduler.tick();
    expect(run!.status).toBe("OK");
    const item = await t.c.db.query<{ raw_ref: string | null }>(`SELECT raw_ref FROM ingestion.external_items WHERE external_id = 'us7000pe99'`);
    expect(item.rows[0]!.raw_ref).toBeNull();
  });

  it("con retención 0 no se guarda nada", async () => {
    const env = await createTestContext({ env: { SOURCE_RAW_RETENTION_DAYS: "0" } });
    expect(await env.c.ingestionScheduler.applyRawRetention()).toEqual({ deleted: 0 });
    await env.close();
  });
});
