import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FEED_ADAPTERS, IngestionScheduler, lastScheduledAt, type FetchResult, type HttpFetcher } from "../src/modules/ingestion/index.js";
import { createTestContext, type TestContext } from "./helpers.js";

const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");
const usgs = FEED_ADAPTERS.get("usgs-geojson")!;
const gdacs = FEED_ADAPTERS.get("gdacs-rss")!;
const cap = FEED_ADAPTERS.get("cap-1.2")!;
const CAP_CONFIG = {
  languages: ["es", "en"],
  eventMap: [
    { match: "sismo", category: "natural.earthquake" },
    { match: "lluvia", category: "natural.flood" },
    { match: "friaje", category: "natural.cold_wave" },
    { match: "helada", category: "natural.cold_wave" },
  ],
};

describe("adapters (sin red)", () => {
  it("USGS: normaliza sismos, descarta explosiones y magnitudes nulas", () => {
    const items = usgs.parse(fixture("usgs-summary.geojson"), {});
    expect(items.map((i) => i.externalId)).toEqual(["us7000pe01", "us7000pe02"]);
    expect(items[0]).toMatchObject({ categoryCode: "natural.earthquake", point: { lat: -14.28, lng: -75.95 }, severity: 3 });
    expect(usgs.isUrgent(items[0]!, {})).toBe(true);
    expect(usgs.isUrgent(items[1]!, {})).toBe(false);
  });

  it("GDACS: mapea tipos a categorías, alertas a severidad y usa ids estables", () => {
    const items = gdacs.parse(fixture("gdacs-rss.xml"), {});
    expect(items.map((i) => [i.externalId, i.categoryCode, i.severity])).toEqual([
      ["FL-1102001", "natural.flood", 4],
      ["EQ-1500001", "natural.earthquake", 2],
    ]);
    expect(gdacs.isUrgent(items[0]!, {})).toBe(true);
    expect(gdacs.isUrgent(items[1]!, {})).toBe(false);
  });

  it("CAP: alerta suelta con título por idioma, centro y radio del polígono, carril urgente por severidad", () => {
    const [a, ...rest] = cap.parse(fixture("cap-alert.xml"), CAP_CONFIG);
    expect(rest).toEqual([]);
    expect(a).toMatchObject({
      externalId: "EJ-2026-0915-001", categoryCode: "natural.flood", severity: 4, point: { lat: -14, lng: -71.25 },
      occurredAt: "2026-09-15T17:00:00.000Z", publishedAt: "2026-09-15T11:00:00.000Z",
      title: { es: "Aviso de lluvias intensas en la sierra sur", en: "Heavy rain warning for the southern highlands" },
      raw: { urgency: "Expected", areaDesc: "Cusco; Puno", expires: "2026-09-16T17:00:00.000Z" },
    });
    expect(a!.uncertaintyM).toBeGreaterThan(150_000);
    expect(a!.uncertaintyM).toBeLessThan(200_000);
    expect(cap.isUrgent(a!, CAP_CONFIG)).toBe(true);
    expect(cap.parse(fixture("cap-alert.xml"), {})).toEqual([]); // sin eventMap no se inventa categoría
  });

  it("CAP en Atom: la actualización conserva el id original; simulacros, cancelaciones, eventos sin mapear y geocódigos sueltos no crean nada", () => {
    const items = cap.parse(fixture("cap-atom.xml"), CAP_CONFIG);
    expect(items.map((i) => [i.externalId, i.categoryCode, i.point])).toEqual([
      ["EJ-SISMO-1", "natural.earthquake", { lat: -14.07, lng: -75.73 }],
      ["EJ-HELADA", "natural.cold_wave", null],
    ]);
    expect(items[0]!.uncertaintyM).toBe(30_000);
    expect(cap.isUrgent(items[0]!, CAP_CONFIG)).toBe(false);
    expect(cap.isUrgent(items[0]!, { urgentMinSeverity: "Moderate" })).toBe(true);
  });

  it("CAP con el perfil Atom cap:*", () => {
    const [f] = cap.parse(fixture("cap-atom-profile.xml"), CAP_CONFIG);
    expect(f).toMatchObject({ externalId: "urn:ej:perfil:1", categoryCode: "natural.cold_wave", severity: 5, title: { en: "Aviso de friaje en la selva sur" } });
    expect(f!.point).not.toBeNull();
  });

  it("horario del carril NORMAL", () => {
    const now = new Date("2026-09-29T04:00:00Z");
    expect(lastScheduledAt("0 5 * * *", now).toISOString()).toBe("2026-09-28T05:00:00.000Z");
    expect(lastScheduledAt("30 */6 * * *", now).toISOString()).toBe("2026-09-29T00:30:00.000Z");
  });
});

class FakeFetcher implements HttpFetcher {
  calls: Array<{ url: string; etag: string | null }> = [];
  next: Array<FetchResult | Error> = [];
  async get(url: string, v: { etag: string | null }): Promise<FetchResult> {
    this.calls.push({ url, etag: v.etag });
    const r = this.next.shift() ?? { status: 304 };
    if (r instanceof Error) throw r;
    return r;
  }
}

describe("planificador NORMAL / URGENT", () => {
  let t: TestContext;
  let fetcher: FakeFetcher;
  let now: Date;
  let scheduler: IngestionScheduler;

  beforeAll(async () => {
    t = await createTestContext();
    await t.c.ingestion.setSourceStatus("usgs-earthquakes", "ACTIVE");
  });
  afterAll(async () => { await t.close(); });
  beforeEach(() => {
    fetcher = new FakeFetcher();
    scheduler = new IngestionScheduler(t.c.db, t.c.ingestion, fetcher, { now: () => now });
  });

  it("el carril URGENT solo ingiere lo crítico; el NORMAL ingiere el resto", async () => {
    now = new Date("2026-09-29T06:00:00Z");
    const body = fixture("usgs-summary.geojson");
    fetcher.next = [{ status: 200, body, etag: "v1" }, { status: 200, body, etag: "v1" }];
    const runs = await scheduler.tick();
    expect(runs.map((r) => [r.lane, r.itemsNew, r.itemsUrgent])).toEqual([
      ["URGENT", 1, 1],
      ["NORMAL", 1, 1],
    ]);
    await t.c.dispatcher.drain();
    const { rows } = await t.c.db.query(`SELECT external_id, lane FROM ingestion.external_items ORDER BY external_id`);
    expect(rows).toEqual([{ external_id: "us7000pe01", lane: "URGENT" }, { external_id: "us7000pe02", lane: "NORMAL" }]);
    // El sismo M5.8 en Perú quedó como evento confirmado oficialmente (fuente oficial registrada).
    const ev = await t.c.db.query(`SELECT verification_level, country_code FROM event.events WHERE category_code = 'natural.earthquake' AND severity = 3`);
    expect(ev.rows[0]).toMatchObject({ verification_level: "OFFICIALLY_CONFIRMED", country_code: "PE" });
  });

  it("respeta los intervalos: el URGENT vuelve a sondear con ETag; el NORMAL espera al día siguiente", async () => {
    now = new Date("2026-09-29T06:01:00Z");
    expect(await scheduler.tick()).toEqual([]);
    now = new Date("2026-09-29T06:02:30Z");
    fetcher.next = [{ status: 304 }];
    const runs = await scheduler.tick();
    expect(runs).toEqual([expect.objectContaining({ lane: "URGENT", status: "NOT_MODIFIED" })]);
    expect(fetcher.calls[0]!.etag).toBe("v1");
  });

  it("circuit breaker: tras 3 fallos seguidos deja de consultar la fuente", async () => {
    fetcher.next = [new Error("timeout"), new Error("timeout"), new Error("timeout")];
    for (const m of [5, 6, 7]) {
      now = new Date(`2026-09-29T06:${String(m).padStart(2, "0")}:00Z`);
      expect((await scheduler.tick())[0]?.status).toBe("FAILED");
    }
    now = new Date("2026-09-29T06:09:00Z");
    expect(await scheduler.tick()).toEqual([]); // abierto 5 min
    now = new Date("2026-09-29T06:13:00Z");
    fetcher.next = [{ status: 304 }];
    expect((await scheduler.tick())[0]).toMatchObject({ status: "NOT_MODIFIED" });
    const { rows } = await t.c.db.query(`SELECT consecutive_failures, open_until FROM ingestion.source_state`);
    expect(rows[0]).toEqual({ consecutive_failures: 0, open_until: null });
  });

  it("las fuentes sin adapter o no activas no se consultan", async () => {
    now = new Date("2026-09-30T06:00:00Z");
    fetcher.next = [{ status: 304 }, { status: 304 }];
    const runs = await scheduler.tick();
    expect(runs.every((r) => r.sourceKey === "usgs-earthquakes")).toBe(true);
  });
});
