import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FEED_ADAPTERS, type NormalizedItem } from "../src/modules/ingestion/index.js";
import { createTestContext, seedGeoFixtures, type TestContext } from "./helpers.js";

// Ítems de fuentes sin coordenadas ubicados por geocódigo exacto con el índice local (ADR 0077). NO AI REQUIRED.
const cap = FEED_ADAPTERS.get("cap-1.2")!;
const CONFIG = { languages: ["es"], eventMap: [{ match: "lluvia", category: "natural.flood" }] };
const xml = readFileSync(new URL("./fixtures/cap-geocode.xml", import.meta.url), "utf8");

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
  await seedGeoFixtures(t);
  await t.c.ingestion.setSourceStatus("gdacs", "ACTIVE");
});
afterAll(async () => { await t.close(); });

const item = (externalId: string, geocodes: NormalizedItem["geocodes"]): NormalizedItem => ({
  externalId, categoryCode: "natural.flood", point: null, uncertaintyM: 0, occurredAt: new Date().toISOString(),
  publishedAt: new Date().toISOString(), title: { es: "Aviso" }, severity: 2, assertion: "OCCURRING", geocodes, raw: {},
});
const stored = async (id: string) => (await t.c.db.query<{ status: string; event_id: string | null; normalized: NormalizedItem }>(
  `SELECT status, event_id, normalized FROM ingestion.external_items WHERE id = $1`, [id],
)).rows[0]!;

describe("geocódigos", () => {
  it("CAP sin polígono: conserva los geocódigos y no inventa un punto", () => {
    const [a] = cap.parse(xml, CONFIG);
    expect(a).toMatchObject({ point: null, geocodes: [{ scheme: "UBIGEO", value: "150124" }, { scheme: "UBIGEO", value: "150138" }] });
  });

  it("ubica la alerta dentro de los distritos por su ubigeo, con un radio que los cubre", async () => {
    const [a] = cap.parse(xml, CONFIG);
    const r = await t.c.ingestion.ingest("gdacs", a!, "NORMAL");
    const row = await stored(r.externalItemId);
    expect(row.status).toBe("MAPPED");
    expect(row.normalized.raw).toMatchObject({ locatedBy: "GEOCODE", areaIds: ["PE:150124", "PE:150138"] });
    const p = row.normalized.point!;
    const inside = await t.c.db.query(
      `SELECT 1 FROM geo.admin_areas WHERE id IN ('PE:150124','PE:150138') AND ST_Intersects(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326))`, [p.lng, p.lat],
    );
    expect(inside.rowCount).toBe(1);
    expect(row.normalized.uncertaintyM).toBeGreaterThan(1000);
    expect(row.normalized.uncertaintyM).toBeLessThan(60_000);
    // El contorno de los distritos queda como área oficial afectada del evento (ADR 0087).
    const snap = await t.c.events.alertSnapshot(t.c.db, row.event_id!);
    expect(snap!.affectedArea?.type).toBe("MultiPolygon");
  });

  it("también con ISO 3166-2", async () => {
    const r = await t.c.ingestion.ingest("gdacs", item("iso-1", [{ scheme: "ISO 3166-2", value: "pe-lim" }]), "NORMAL");
    expect((await stored(r.externalItemId)).status).toBe("MAPPED");
  });

  it("códigos desconocidos, mal formados o de otro esquema dejan el ítem sin mapa", async () => {
    for (const [id, codes] of [
      ["x-1", [{ scheme: "UBIGEO", value: "999999" }]],
      ["x-2", [{ scheme: "UBIGEO", value: "15A" }]],
      ["x-3", [{ scheme: "FIPS", value: "PE15" }]],
    ] as const) {
      const r = await t.c.ingestion.ingest("gdacs", item(id, [...codes]), "NORMAL");
      const row = await stored(r.externalItemId);
      expect(row).toMatchObject({ status: "IGNORED", event_id: null });
      expect(row.normalized.point).toBeNull();
    }
  });
});
