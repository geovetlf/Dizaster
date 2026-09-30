import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IngestionScheduler, type FetchResult, type HttpFetcher } from "../src/modules/ingestion/index.js";
import { parseWorkerRoles, ROLE_LANES } from "../src/worker-roles.js";
import { createTestContext, type TestContext } from "./helpers.js";

describe("roles del worker (ADR 0159)", () => {
  it("valida los roles y reparte los carriles del outbox sin solaparse", () => {
    expect(parseWorkerRoles("urgent, normal,urgent")).toEqual(["urgent", "normal"]);
    expect(() => parseWorkerRoles("urgent,otro")).toThrow(/otro/);
    expect(() => parseWorkerRoles(" , ")).toThrow();
    const all = [...ROLE_LANES.urgent, ...ROLE_LANES.normal];
    expect(new Set(all).size).toBe(all.length);
    expect(all.sort()).toEqual(["batch", "interactive", "normal", "urgent"]);
  });
});

describe("tick por carril", () => {
  let t: TestContext;
  beforeAll(async () => {
    t = await createTestContext();
    await t.c.ingestion.setSourceStatus("usgs-earthquakes", "ACTIVE");
  });
  afterAll(() => t.close());

  it("el worker urgente solo sondea URGENT y el normal solo NORMAL", async () => {
    const body = readFileSync(new URL("./fixtures/usgs-summary.geojson", import.meta.url), "utf8");
    const fetcher: HttpFetcher = { get: async (): Promise<FetchResult> => ({ status: 200, body, etag: null }) };
    const now = new Date("2026-09-29T06:00:00Z");
    const s = new IngestionScheduler(t.c.db, t.c.ingestion, fetcher, { now: () => now });
    expect((await s.tick(["URGENT"])).map((r) => r.lane)).toEqual(["URGENT"]);
    expect((await s.tick(["NORMAL"])).map((r) => r.lane)).toEqual(["NORMAL"]);
    expect(await s.tick(["NORMAL"])).toEqual([]);
  });
});
