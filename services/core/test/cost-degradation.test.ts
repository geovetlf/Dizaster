import { INGESTION_NORMAL_KILL_SWITCH } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IngestionScheduler, type FetchResult, type HttpFetcher } from "../src/modules/ingestion/index.js";
import { createTestContext, type TestContext } from "./helpers.js";

// Degradación automática por costo fuera de IA (ADR 0138). NO AI REQUIRED.
let t: TestContext;
const kills = async () =>
  Object.fromEntries((await t.c.db.query<{ feature: string; killed: boolean; auto: boolean }>(`SELECT feature, killed, auto FROM cost.kill_switches WHERE feature IN ('video', 'media-upload', 'ingestion-normal') ORDER BY feature`)).rows
    .map((r) => [r.feature, `${r.killed ? "off" : "on"}${r.auto ? "/auto" : ""}`]));
const setUsage = async (units: number) => {
  const day = t.c.clock.now().toISOString().slice(0, 10);
  await t.c.db.query(
    `INSERT INTO cost.usage_daily (day, module, metric, provider, units) VALUES ($1, 'test', 'units', '', $2)
     ON CONFLICT (day, module, metric, provider) DO UPDATE SET units = EXCLUDED.units`, [day, units]);
};

beforeAll(async () => {
  t = await createTestContext();
  // Precio de prueba: 1 USD por unidad. Almacenamiento a 0 para que el porcentaje dependa solo del uso.
  t.c.cost.prices.unitPrices["test.units"] = { usd: 1 };
  t.c.cost.prices.storageGbMonthUsd.media = 0;
  t.c.cost.prices.storageGbMonthUsd.database = 0;
});
afterAll(async () => { await t.close(); });

describe("degradación automática por costo", () => {
  it("sin presupuesto infra no apaga nada", async () => {
    await setUsage(1000);
    expect(await t.c.cost.applyDegradation()).toEqual({ percent: null, changed: [] });
    expect(await kills()).toEqual({});
  });

  it("apaga video, luego fotos nuevas, luego fuentes no urgentes, y restaura solo lo automático", async () => {
    await t.c.cost.setBudget("infra", { period: "MONTHLY", limitUsd: 100, reason: "Presupuesto de prueba" }, null);
    await setUsage(90);
    expect(await t.c.cost.applyDegradation()).toEqual({ percent: 90, changed: [] });

    await setUsage(100);
    expect((await t.c.cost.applyDegradation()).changed).toEqual([{ feature: "video", killed: true }]);
    await setUsage(115);
    expect((await t.c.cost.applyDegradation()).changed).toEqual([{ feature: "media-upload", killed: true }]);
    await setUsage(130);
    expect((await t.c.cost.applyDegradation()).changed).toEqual([{ feature: INGESTION_NORMAL_KILL_SWITCH, killed: true }]);
    expect(await kills()).toEqual({ [INGESTION_NORMAL_KILL_SWITCH]: "off/auto", "media-upload": "off/auto", video: "off/auto" });
    expect(await t.c.cost.isKilled(INGESTION_NORMAL_KILL_SWITCH)).toBe(true);
    // Repetir no publica nada nuevo.
    expect((await t.c.cost.applyDegradation()).changed).toEqual([]);

    // Una persona decide mantener el video apagado: la regla ya no lo devuelve sola.
    await t.c.cost.setKillSwitch("video", { killed: true, reason: "decisión manual" }, null);
    await setUsage(50);
    const back = await t.c.cost.applyDegradation();
    expect(back.changed).toEqual([{ feature: "media-upload", killed: false }, { feature: INGESTION_NORMAL_KILL_SWITCH, killed: false }]);
    expect(await kills()).toEqual({ [INGESTION_NORMAL_KILL_SWITCH]: "on", "media-upload": "on", video: "off" });

    const published = (await t.c.db.query<{ type: string; payload: { feature?: string; threshold?: number } }>(
      `SELECT type, payload FROM platform.outbox WHERE type IN ('CostDegradationChanged', 'BudgetThresholdReached') ORDER BY occurred_at`)).rows;
    expect(published.filter((e) => e.type === "CostDegradationChanged")).toHaveLength(5);
    expect(published.filter((e) => e.type === "BudgetThresholdReached").map((e) => e.payload.threshold)).toEqual([50, 80, 100]);
  });

  it("con el interruptor activo el carril NORMAL se pausa y el URGENT sigue", async () => {
    await t.c.ingestion.setSourceStatus("gdacs", "ACTIVE");
    const fetcher: HttpFetcher = { async get(): Promise<FetchResult> { return { status: 304 }; } };
    const lanes = async (paused: boolean, at: string) =>
      [...new Set((await new IngestionScheduler(t.c.db, t.c.ingestion, fetcher, { now: () => new Date(at) }, {}, null, async () => paused).tick()).map((r) => r.lane))].sort();
    expect(await lanes(true, "2026-09-29T06:00:00Z")).toEqual(["URGENT"]);
    expect(await lanes(false, "2026-09-29T07:00:00Z")).toEqual(["NORMAL", "URGENT"]);
  });
});
