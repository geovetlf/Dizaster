import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { firmsAdapter, firmsConfidence, frpToSeverity } from "../src/modules/ingestion/adapters/firms.js";
import { IngestionScheduler, resolveSourceUrl, type FetchResult, type HttpFetcher } from "../src/modules/ingestion/index.js";
import { createTestContext, type TestContext } from "./helpers.js";

const csv = readFileSync(new URL("./fixtures/firms-viirs.csv", import.meta.url), "utf8");
const CONFIG = { minConfidence: "nominal", urgentMinFrp: 100, maxItems: 2000 };

describe("adaptador NASA FIRMS (ADR 0067)", () => {
  it("convierte focos en candidatos de incendio forestal, sin los de baja confianza", () => {
    const items = firmsAdapter.parse(csv, CONFIG);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      externalId: "N-2026-09-29-0540--12.5123--69.1877", categoryCode: "fire.wildfire", point: { lat: -12.51234, lng: -69.18765 },
      occurredAt: "2026-09-29T05:40:00.000Z", severity: 3, assertion: "OCCURRING", uncertaintyM: 225,
    });
    // Más potente primero; el id es estable entre descargas.
    expect(items.map((i) => i.raw["frp"])).toEqual([152.3, 41, 12.5]);
    expect(firmsAdapter.parse(csv, CONFIG)[0]!.externalId).toBe(items[0]!.externalId);
    expect(firmsAdapter.parse(csv, { ...CONFIG, minConfidence: "low" })).toHaveLength(4);
    expect(firmsAdapter.parse(csv, { ...CONFIG, maxItems: 1 })).toHaveLength(1);
  });

  it("urgente solo con confianza alta y potencia alta", () => {
    const [strong, weak] = firmsAdapter.parse(csv, CONFIG);
    expect(firmsAdapter.isUrgent(strong!, CONFIG)).toBe(true);
    expect(firmsAdapter.isUrgent(weak!, CONFIG)).toBe(false);
  });

  it("confianza MODIS en porcentaje y severidad por potencia", () => {
    expect([firmsConfidence("85"), firmsConfidence("50"), firmsConfidence("10"), firmsConfidence("x")]).toEqual(["high", "nominal", "low", null]);
    expect([frpToSeverity(5), frpToSeverity(150), frpToSeverity(900)]).toEqual([2, 3, 4]);
  });

  it("una respuesta que no es el CSV (clave inválida) falla sin repetir el cuerpo", () => {
    expect(() => firmsAdapter.parse("Invalid MAP_KEY.", CONFIG)).toThrow(/FIRMS: respuesta inesperada/);
  });

  it("la clave sale del entorno, nunca de data/", () => {
    const url = "https://firms.example/api/area/csv/{secret:SOURCE_KEY_FIRMS}/VIIRS/x/1";
    expect(resolveSourceUrl(url, { SOURCE_KEY_FIRMS: "abc/123" })).toBe("https://firms.example/api/area/csv/abc%2F123/VIIRS/x/1");
    expect(() => resolveSourceUrl(url, {})).toThrow("Falta el secreto SOURCE_KEY_FIRMS");
    const sources = readFileSync(new URL("../../../data/source-registry/sources.json", import.meta.url), "utf8");
    expect(sources).toContain("{secret:SOURCE_KEY_FIRMS}");
  });
});

class RoutingFetcher implements HttpFetcher {
  urls: string[] = [];
  async get(url: string): Promise<FetchResult> {
    this.urls.push(url);
    if (url.includes("firms")) return { status: 200, body: csv };
    return { status: 304 };
  }
}

describe("FIRMS en el planificador", () => {
  let t: TestContext;
  beforeAll(async () => {
    t = await createTestContext();
    await t.c.ingestion.setSourceStatus("nasa-firms", "ACTIVE");
  });
  afterAll(async () => { await t.c.ingestion.setSourceStatus("nasa-firms", "PLANNED"); await t.close(); });

  it("varios focos cercanos forman un solo incendio; la clave no queda en errores ni en la base", async () => {
    const fetcher = new RoutingFetcher();
    const scheduler = new IngestionScheduler(t.c.db, t.c.ingestion, fetcher, { now: () => new Date("2026-09-29T08:00:00Z") }, { SOURCE_KEY_FIRMS: "clave-secreta-123" });
    const runs = await scheduler.tick();
    expect(runs.filter((r) => r.sourceKey === "nasa-firms").map((r) => r.status)).toEqual(expect.arrayContaining(["OK"]));
    await t.c.dispatcher.drain();
    const { rows } = await t.c.db.query<{ n: number }>(
      `SELECT count(DISTINCT e.id)::int AS n FROM event.events e
        WHERE e.category_code = 'fire.wildfire' AND ST_DWithin(e.geom, ST_SetSRID(ST_MakePoint(-69.187, -12.512), 4326)::geography, 3000)`,
    );
    expect(rows[0]!.n).toBe(1);
    expect(fetcher.urls.some((u) => u.includes("clave-secreta-123"))).toBe(true);
    const leaked = await t.c.db.query(`SELECT 1 FROM ingestion.runs WHERE error LIKE '%clave-secreta%' UNION ALL SELECT 1 FROM ingestion.sources WHERE config::text LIKE '%clave-secreta%'`);
    expect(leaked.rowCount).toBe(0);
  });

  it("sin la clave falla con un mensaje claro", async () => {
    const scheduler = new IngestionScheduler(t.c.db, t.c.ingestion, new RoutingFetcher(), { now: () => new Date("2026-09-30T08:00:00Z") }, {});
    const runs = await scheduler.tick();
    expect(runs.find((r) => r.sourceKey === "nasa-firms")?.status).toBe("FAILED");
    const { rows } = await t.c.db.query<{ error: string }>(
      `SELECT r.error FROM ingestion.runs r JOIN ingestion.sources s ON s.id = r.source_id WHERE s.key = 'nasa-firms' ORDER BY r.started_at DESC LIMIT 1`,
    );
    expect(rows[0]!.error).toContain("Falta el secreto SOURCE_KEY_FIRMS");
  });
});
