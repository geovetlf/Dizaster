import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IngestionScheduler, type FetchResult, type HttpFetcher } from "../src/modules/ingestion/index.js";
import { parsePromotionRule, promoteByRule } from "../src/modules/ingestion/promotion.js";
import { createTestContext, type TestContext } from "./helpers.js";

const item = (over: Partial<Parameters<typeof promoteByRule>[0]> = {}) => ({
  severity: null, title: { en: "Cholera – Haiti" }, categoryCode: "health.outbreak", assertion: "OCCURRING" as const, ...over,
});

describe("regla de promoción NORMAL → URGENT (ADR 0100)", () => {
  it("por palabra completa del título, sin tildes ni mayúsculas, en cualquier idioma", () => {
    expect(promoteByRule(item(), { keywords: ["cólera", "cholera"] })).toBe(true);
    expect(promoteByRule(item({ title: { es: "Brote de CÓLERA en Haití" } }), { keywords: ["colera"] })).toBe(true);
    expect(promoteByRule(item({ title: { en: "Cholerae research update" } }), { keywords: ["cholera"] })).toBe(false);
    expect(promoteByRule(item({ title: { en: "Yellow fever - Peru" } }), { keywords: ["yellow fever"] })).toBe(true);
    expect(promoteByRule(item({ title: { en: "Dengue - Peru" } }), { keywords: ["cholera"] })).toBe(false);
  });
  it("por severidad o categoría; nunca un desmentido; sin regla, nada", () => {
    expect(promoteByRule(item({ severity: 4 }), { minSeverity: 4 })).toBe(true);
    expect(promoteByRule(item({ severity: 3 }), { minSeverity: 4 })).toBe(false);
    expect(promoteByRule(item({ categoryCode: "natural.tsunami" }), { categories: ["natural.tsunami"] })).toBe(true);
    expect(promoteByRule(item({ categoryCode: "natural.volcano.ash" }), { categories: ["natural.volcano"] })).toBe(true);
    expect(promoteByRule(item({ assertion: "NOT_OCCURRING" }), { keywords: ["cholera"] })).toBe(false);
    expect(promoteByRule(item(), undefined)).toBe(false);
    expect(parsePromotionRule({ minSeverity: 9, keywords: ["ab"] })).toBeNull();
  });
});

describe("promoción en el planificador", () => {
  let t: TestContext;
  beforeAll(async () => {
    t = await createTestContext();
    await t.c.ingestion.setSourceStatus("who-don", "ACTIVE");
  });
  afterAll(async () => { await t.close(); });

  it("los brotes graves de la OMS entran por el carril URGENT; el resto, NORMAL", async () => {
    const body = readFileSync(new URL("./fixtures/who-don.json", import.meta.url), "utf8");
    const fetcher: HttpFetcher = { get: async (): Promise<FetchResult> => ({ status: 200, body }) };
    const scheduler = new IngestionScheduler(t.c.db, t.c.ingestion, fetcher, { now: () => new Date("2026-09-29T06:00:00Z") });
    const runs = (await scheduler.tick()).filter((r) => r.sourceKey === "who-don");
    expect(runs.map((r) => [r.lane, r.itemsUrgent])).toEqual([["NORMAL", 2]]);
    const { rows } = await t.c.db.query(
      `SELECT i.external_id, i.lane FROM ingestion.external_items i JOIN ingestion.sources s ON s.id = i.source_id WHERE s.key = 'who-don' ORDER BY 1`,
    );
    expect(rows).toEqual([
      { external_id: "don-a1b2c3", lane: "URGENT" },
      { external_id: "don-d4e5f6", lane: "NORMAL" },
      { external_id: "don-g7h8i9", lane: "URGENT" },
    ]);
  });
});
