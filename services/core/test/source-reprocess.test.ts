import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IngestionScheduler, type FetchResult, type HttpFetcher } from "../src/modules/ingestion/index.js";
import { createTestContext, type TestContext } from "./helpers.js";

// Re-procesar el crudo guardado de una fuente (ADR 0133). NO AI REQUIRED.
const body = readFileSync(new URL("./fixtures/gdacs-rss.xml", import.meta.url), "utf8");
class QueueFetcher implements HttpFetcher {
  next: FetchResult[] = [];
  async get(): Promise<FetchResult> { return this.next.shift() ?? { status: 304 }; }
}

let t: TestContext;
let now = new Date("2026-09-29T06:00:00Z");
let scheduler: IngestionScheduler;
const fetcher = new QueueFetcher();
const normalized = async (externalId: string) =>
  (await t.c.db.query<{ normalized: { categoryCode: string; title?: { en?: string } } }>(
    `SELECT i.normalized FROM ingestion.external_items i JOIN ingestion.sources s ON s.id = i.source_id WHERE s.key = 'gdacs' AND i.external_id = $1`, [externalId],
  )).rows[0]?.normalized;

beforeAll(async () => {
  t = await createTestContext();
  await t.c.ingestion.setSourceStatus("gdacs", "ACTIVE");
  scheduler = new IngestionScheduler(t.c.db, t.c.ingestion, fetcher, { now: () => now }, {}, { storage: t.c.storage, retentionDays: 30 });
});
afterAll(async () => { await t.close(); });

describe("re-procesar el crudo de una fuente", () => {
  it("aplica la configuración corregida sin volver a consultar la fuente", async () => {
    fetcher.next = [{ status: 200, body }, { status: 200, body }];
    await scheduler.tick();
    const ids = (await t.c.db.query<{ external_id: string }>(`SELECT external_id FROM ingestion.external_items ORDER BY external_id`)).rows.map((r) => r.external_id);
    expect(ids).toEqual(["FL-1102001"]); // carril URGENT: solo lo crítico; el tipo "XX" no tiene categoría
    const flood = ids[0]!;
    expect((await normalized(flood))!.categoryCode).toBe("natural.flood");

    // Se corrige el mapa: las inundaciones de GDACS pasan a otra categoría. "XX" gana una, pero sin fechas se descarta.
    await t.c.db.query(`UPDATE ingestion.sources SET config = jsonb_set(jsonb_set(config, '{categoryMap,FL}', '"natural.storm"'), '{categoryMap,XX}', '"natural.storm"') WHERE key = 'gdacs'`);
    const r = await scheduler.reprocess("gdacs");
    expect(r).toMatchObject({ documents: 1, itemsSeen: 2, itemsNew: 2, status: "OK" });
    expect((await normalized(flood))!.categoryCode).toBe("natural.storm");
    const runs = (await t.c.db.query<{ status: string }>(`SELECT status FROM ingestion.runs WHERE trigger = 'REPROCESS'`)).rows;
    expect(runs).toEqual([{ status: "OK" }]);
    // Repetirlo no cambia nada.
    expect(await scheduler.reprocess("gdacs")).toMatchObject({ itemsSeen: 2, itemsNew: 0 });
  });

  it("gana la última versión de cada ítem, aunque haya crudos más viejos", async () => {
    now = new Date("2026-09-29T09:00:00Z");
    const newer = body.replace("Orange flood alert in Peru", "Red flood alert in Peru");
    fetcher.next = [{ status: 200, body: newer }, { status: 304 }];
    await scheduler.tick();
    const flood = (await t.c.db.query<{ external_id: string }>(`SELECT external_id FROM ingestion.external_items WHERE external_id LIKE '%1102001%'`)).rows[0]!.external_id;
    await scheduler.reprocess("gdacs");
    expect(JSON.stringify(await normalized(flood))).toContain("Red flood alert");
    // Por rango de fechas: solo el primer documento, que ya estaba aplicado para el resto de ítems.
    expect(await scheduler.reprocess("gdacs", { to: new Date("2026-09-29T07:00:00Z") })).toMatchObject({ documents: 1 });
  });

  it("rechaza fuentes desconocidas o inactivas", async () => {
    await expect(scheduler.reprocess("no-existe")).rejects.toThrow(/desconocida/);
    await t.c.ingestion.setSourceStatus("gdacs", "PAUSED");
    await expect(scheduler.reprocess("gdacs")).rejects.toThrow(/no está activa/);
  });
});
