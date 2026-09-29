import type { AreaSearchResult, EventSummary, FeedResponse } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importDataset, loadManifest, labelFor, searchKey, titleCaseEs } from "../src/modules/geo/index.js";
import { defaultDataDir } from "../src/platform/paths.js";
import { createTestContext, createUser, reportBody, seedGeoFixtures, submit, type TestContext } from "./helpers.js";

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
  await seedGeoFixtures(t);
});
afterAll(async () => { await t.close(); });

const MIRAFLORES = { lat: -12.1211, lng: -77.0297 };
const CALLAO = { lat: -12.0566, lng: -77.1181 };
// Dentro de la provincia de Lima pero sin polígono distrital en la fuente abierta (8 distritos vienen sin geometría).
const NO_DISTRICT = { lat: -11.995975, lng: -76.699670 };
const TOKYO = { lat: 35.6895, lng: 139.6917 };

describe("nombres", () => {
  it("normaliza topónimos en mayúsculas y claves de búsqueda sin tildes", () => {
    expect(titleCaseEs("SAN JUAN DE LURIGANCHO")).toBe("San Juan de Lurigancho");
    expect(titleCaseEs("LA VICTORIA")).toBe("La Victoria");
    expect(titleCaseEs("BREÑA")).toBe("Breña");
    expect(searchKey("Jesús María")).toBe("jesus maria");
    expect(labelFor({ name: "Perú" }, { name: "Callao" }, { name: "Callao" }, { name: "Callao" })).toBe("Callao");
    expect(labelFor({ name: "Perú" }, { name: "Lima" }, null, null)).toBe("Lima, Perú");
  });
});

describe("importación", () => {
  it("guarda jerarquía, códigos oficiales, tildes corregidas y trazabilidad del dataset", async () => {
    const { rows } = await t.c.db.query<{ id: string; name: string; parent_id: string; level: number; code: string }>(
      `SELECT id, name, parent_id, level, code FROM geo.admin_areas WHERE id IN ('PE:150113', 'PE:150135', 'PE:1501', 'PE:15') ORDER BY id`,
    );
    expect(rows).toEqual([
      { id: "PE:15", name: "Lima", parent_id: null, level: 1, code: "15" },
      { id: "PE:1501", name: "Lima", parent_id: "PE:15", level: 2, code: "1501" },
      { id: "PE:150113", name: "Jesús María", parent_id: "PE:1501", level: 3, code: "150113" },
      { id: "PE:150135", name: "San Martín de Porres", parent_id: "PE:1501", level: 3, code: "150135" },
    ]);
    const ds = await t.app.inject({ url: "/v1/geo/datasets" });
    expect(ds.json().datasets.find((d: { id: string }) => d.id === "pe-distritos")).toMatchObject({ license: expect.stringContaining("MPL-2.0") });
  });

  it("rechaza un archivo cuya huella no coincide con el manifiesto", async () => {
    const manifest = loadManifest(defaultDataDir());
    const spec = manifest.datasets.find((d) => d.id === "pe-departamentos")!;
    await expect(importDataset(t.c.db, manifest, spec, Buffer.from('{"features":[]}'))).rejects.toThrow(/sha256/);
  });
});

describe("resolveAdmin: país → región → ciudad → distrito sin API externa", () => {
  it("Miraflores, Lima", async () => {
    const ctx = await t.c.geo.contextFor(t.c.db, MIRAFLORES, "NORMAL");
    expect(ctx).toEqual({
      country: { code: "PE", name: "Perú" },
      region: { id: "PE:15", code: "15", name: "Lima" },
      city: { id: "PE:1501", name: "Lima" },
      district: { id: "PE:150122", code: "150122", name: "Miraflores" },
      label: "Miraflores, Lima",
      granularity: "DISTRICT",
      timezone: "America/Lima",
    });
  });

  it("colapsa nombres repetidos (Callao)", async () => {
    expect((await t.c.geo.contextFor(t.c.db, CALLAO, "NORMAL"))?.label).toBe("Callao");
  });

  it("HIGHLY_SENSITIVE no publica el distrito", async () => {
    const ctx = await t.c.geo.contextFor(t.c.db, MIRAFLORES, "HIGHLY_SENSITIVE");
    expect(ctx).toMatchObject({ district: null, city: { name: "Lima" }, label: "Lima", granularity: "CITY" });
  });

  it("un punto generalizado que cae en el mar junto a la costa se asigna al distrito costero", async () => {
    const ctx = await t.c.geo.contextFor(t.c.db, { lat: -12.1335, lng: -77.0395 }, "NORMAL");
    expect(ctx?.region?.id).toBe("PE:15");
    expect(["Miraflores", "Barranco"]).toContain(ctx?.district?.name);
  });

  it("si el distrito falta en los datos no inventa el vecino: se queda en la ciudad", async () => {
    const ctx = await t.c.geo.contextFor(t.c.db, NO_DISTRICT, "NORMAL");
    expect(ctx).toMatchObject({ district: null, city: { id: "PE:1501" }, label: "Lima", granularity: "CITY" });
  });

  it("fuera del piloto usa datos globales: región Natural Earth y ciudad por cercanía", async () => {
    const ctx = await t.c.geo.contextFor(t.c.db, TOKYO, "NORMAL");
    expect(ctx).toMatchObject({ country: { code: "JP", name: "Japón" }, region: { id: "NE1:JPN-1860", name: "Tokio" }, city: { name: "Tokyo" }, district: null, timezone: "Asia/Tokyo" });
  });

  it("memoriza por celda H3 y la importación invalida la memoria", async () => {
    const count = async () => Number((await t.c.db.query(`SELECT count(*) AS n FROM geo.context_cache`)).rows[0].n);
    const before = await count();
    await t.c.geo.resolveAdmin(t.c.db, MIRAFLORES);
    expect(await count()).toBe(before);
    await seedGeoFixtures(t);
    expect(await count()).toBe(0);
  });
});

describe("tres ubicaciones separadas", () => {
  it("el EVENT expone su lugar contextual calculado desde su punto público, no desde el GPS del reportero", async () => {
    const u = await createUser(t, "geo_reporter");
    const fix = { lat: -12.1185, lng: -77.0296 }; // presencia privada, a ~300 m del pin
    const { status, body } = await submit(t, u, reportBody(u, { category: "accident.traffic", pin: MIRAFLORES, fix, text: "Choque en Larco" }));
    expect(status).toBe(200);
    const ev = (await t.app.inject({ url: `/v1/events/${body.eventId}` })).json() as EventSummary;
    expect(ev.place?.label).toBe("Miraflores, Lima");
    expect(ev.place).toEqual(await t.c.geo.contextFor(t.c.db, ev.point, ev.sensitivity));
    const raw = JSON.stringify(ev);
    expect(raw).not.toContain(String(fix.lat));
    const { posts } = (await t.app.inject({ url: "/v1/feed?tab=for_you" })).json() as FeedResponse;
    expect(posts.find((p) => p.text === "Choque en Larco")?.place?.label).toBe("Miraflores, Lima");
  });

  it("un evento muy sensible no guarda ni muestra el distrito", async () => {
    const u = await createUser(t, "geo_sensitive");
    const { body } = await submit(t, u, reportBody(u, { category: "crime.violence", pin: MIRAFLORES, text: "Agresión" }));
    const ev = (await t.app.inject({ url: `/v1/events/${body.eventId}` })).json() as EventSummary;
    expect(ev.place).toMatchObject({ district: null, granularity: "CITY" });
    const row = (await t.c.db.query(`SELECT district_id, region_id FROM event.events WHERE id = $1`, [body.eventId])).rows[0];
    expect(row).toEqual({ district_id: null, region_id: "PE:15" });
  });
});

describe("búsqueda de lugares", () => {
  const search = async (qs: string) => {
    const res = await t.app.inject({ url: `/v1/geo/areas?${qs}` });
    expect(res.statusCode).toBe(200);
    return (res.json() as { areas: AreaSearchResult[] }).areas;
  };

  it("sin tildes y por palabra", async () => {
    expect((await search("q=jesus"))[0]).toMatchObject({ id: "PE:150113", label: "Jesús María, Lima, Perú" });
    expect((await search("q=porres"))[0]?.id).toBe("PE:150135");
  });

  it("homónimos distinguibles por su jerarquía y la fuente oficial oculta la global", async () => {
    const mira = await search("q=miraflores");
    expect(mira.map((a) => a.label).sort()).toEqual(["Miraflores, Arequipa, Perú", "Miraflores, Lima, Perú", "San Juan de Miraflores, Lima, Perú"]);
    expect(mira[2]?.label).toBe("San Juan de Miraflores, Lima, Perú"); // coincidencia al inicio del nombre primero
    const lima = await search("q=lima&country=PE");
    expect(lima.every((a) => a.id.startsWith("PE:"))).toBe(true);
    expect(lima[0]).toMatchObject({ id: "PE:15", level: 1 });
  });

  it("ordena homónimos por cercanía aproximada del lector y nombra el nivel del país", async () => {
    const [first] = await search("q=miraflores&lat=-16.40&lng=-71.54");
    expect(first).toMatchObject({ id: "PE:040110", kind: "Distrito", label: "Miraflores, Arequipa, Perú" });
    expect((await search("q=lima&country=PE"))[0]?.kind).toBe("Departamento");
  });

  it("valida la consulta", async () => {
    expect((await t.app.inject({ url: "/v1/geo/areas?q=a" })).statusCode).toBe(400);
  });
});

describe("fuentes con áreas partidas", () => {
  it("une piezas con el mismo código y conserva el nombre de la mayor", async () => {
    const { mergeSplitFeatures } = await import("../src/modules/geo/importer.js");
    const sq = (x: number, s: number) => [[[x, 0], [x + s, 0], [x + s, s], [x, s], [x, 0]]];
    const merged = mergeSplitFeatures(
      [
        { properties: { ID: "2001", N: "PIURA" }, geometry: { type: "Polygon", coordinates: sq(0, 2) } },
        { properties: { ID: "2002", N: "SULLANA" }, geometry: { type: "Polygon", coordinates: sq(5, 1) } },
        { properties: { ID: "2001", N: "PUIRA" }, geometry: { type: "Polygon", coordinates: sq(3, 0.5) } },
      ],
      "ID",
    );
    expect(merged.map((f) => f.properties?.["N"])).toEqual(["PIURA", "SULLANA"]);
    expect(merged[0]!.geometry).toMatchObject({ type: "MultiPolygon", coordinates: [sq(0, 2), sq(3, 0.5)] });
  });
});
