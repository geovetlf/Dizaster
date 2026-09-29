import type { AreaGeometry, NotificationsResponse } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTransaction } from "../src/platform/db.js";
import { FEED_ADAPTERS, type NormalizedItem } from "../src/modules/ingestion/index.js";
import { createTestContext, createUser, offset, seedGeoFixtures, type TestContext, type TestUser } from "./helpers.js";

// Alertas por el área oficial afectada, no solo por el punto (ADR 0087, Blueprint §5.10, §9.4). NO AI REQUIRED.
let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
  await seedGeoFixtures(t);
  await t.c.ingestion.setSourceStatus("usgs-earthquakes", "ACTIVE");
});
afterAll(async () => { await t.close(); });

const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });
const inbox = async (u: TestUser) => (await t.app.inject({ url: "/v1/me/notifications", headers: auth(u) })).json() as NotificationsResponse;
const box = (w: number, s: number, e: number, n: number): AreaGeometry => ({
  type: "MultiPolygon", coordinates: [[[[w, s], [e, s], [e, n], [w, n], [w, s]]]],
});

describe("CAP: contorno del área", () => {
  const cap = FEED_ADAPTERS.get("cap-1.2")!;
  const CONFIG = { languages: ["es"], eventMap: [{ match: "lluvia", category: "natural.flood" }] };
  const alert = (area: string) => `<?xml version="1.0"?><alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
    <identifier>A-1</identifier><sender>x@example.org</sender><sent>2026-09-15T06:00:00-05:00</sent><status>Actual</status>
    <msgType>Alert</msgType><scope>Public</scope><info><language>es</language><category>Met</category><event>Lluvias</event>
    <urgency>Expected</urgency><severity>Severe</severity><certainty>Likely</certainty><area><areaDesc>Z</areaDesc>${area}</area></info></alert>`;

  it("un polígono pasa a MultiPolygon [lng, lat] cerrado; un círculo, a 32 lados", () => {
    const [p] = cap.parse(alert("<polygon>-13.0,-72.5 -13.0,-70.0 -15.0,-70.0 -15.0,-72.5</polygon>"), CONFIG);
    expect(p!.area!.coordinates[0]![0]).toEqual([[-72.5, -13], [-70, -13], [-70, -15], [-72.5, -15], [-72.5, -13]]);
    const [c] = cap.parse(alert("<circle>-12.0,-77.0 10</circle>"), CONFIG);
    const ring = c!.area!.coordinates[0]![0]!;
    expect(ring).toHaveLength(33);
    expect(ring[0]).toEqual(ring[32]);
  });
});

describe("alertas por área oficial", () => {
  it("avisa a zonas, cercanía y áreas seguidas dentro del área aunque lejos del punto; fuera, no", async () => {
    // Centro del distrito de las pruebas y un área larga hacia el oeste: el punto del evento queda a ~50 km.
    const c = (await t.c.db.query<{ lat: number; lng: number }>(
      `SELECT ST_Y(ST_PointOnSurface(geom)) AS lat, ST_X(ST_PointOnSurface(geom)) AS lng FROM geo.admin_areas WHERE id = 'PE:150122'`,
    )).rows[0]!;
    const area = box(c.lng - 1.0, c.lat - 0.05, c.lng + 0.02, c.lat + 0.05);
    const point = { lat: c.lat, lng: c.lng - 0.49 };

    const dentro = await createUser(t, "area_dentro");
    const fuera = await createUser(t, "area_fuera");
    const sigue = await createUser(t, "area_sigue");
    const cerca = await createUser(t, "area_cerca");
    for (const u of [dentro, fuera, sigue, cerca]) {
      await t.app.inject({ method: "PUT", url: "/v1/me/alert-preferences", headers: auth(u), payload: { savedZones: true, nearMe: true } });
    }
    await t.app.inject({ method: "POST", url: "/v1/me/zones", headers: auth(dentro), payload: { kind: "HOME", lat: c.lat, lng: c.lng, radiusKm: 2 } });
    const far = offset(c, 0, 30_000);
    await t.app.inject({ method: "POST", url: "/v1/me/zones", headers: auth(fuera), payload: { kind: "HOME", lat: far.lat, lng: far.lng, radiusKm: 2 } });
    expect((await t.app.inject({ method: "PUT", url: "/v1/follows/place/PE:150122", headers: auth(sigue) })).statusCode).toBe(200);
    expect((await t.app.inject({ method: "PUT", url: "/v1/me/approximate-location", headers: auth(cerca), payload: offset(c, 200) })).json()).toEqual({ stored: true });

    const now = new Date().toISOString();
    const item: NormalizedItem = {
      externalId: "us-area-1", categoryCode: "natural.earthquake", point, uncertaintyM: 60_000, occurredAt: now, publishedAt: now,
      title: { es: "Sismo" }, severity: 4, assertion: "OCCURRING", area, raw: {},
    };
    const r = await t.c.ingestion.ingest("usgs-earthquakes", item, "URGENT");
    const eventId = (r.resolution as { eventId: string }).eventId;
    await t.c.dispatcher.drain();

    const snap = await t.c.events.alertSnapshot(t.c.db, eventId);
    expect(snap!.affectedArea?.type).toBe("MultiPolygon");
    const matches = async (u: TestUser) => (await inbox(u)).notifications.filter((n) => n.eventId === eventId).map((n) => n.match);
    expect(await matches(dentro)).toEqual(["SAVED_ZONE"]);
    expect(await matches(sigue)).toEqual(["FOLLOWED_PLACE"]);
    expect(await matches(cerca)).toEqual(["NEAR_ME"]);
    expect(await matches(fuera)).toEqual([]);
  });

  it("un reporte ciudadano nunca aporta área", async () => {
    const res = await t.c.events.resolveCandidate(t.c.db, {
      origin: "CITIZEN_REPORT", originRef: { kind: "REPORT", id: "0192f0a0-0000-7000-8000-000000000001" }, categoryCode: "fire.structure",
      point: { lat: -12.3, lng: -76.8 }, locationUncertaintyM: 10, occurredAt: new Date().toISOString(), observedAt: new Date().toISOString(),
      trustTier: "CITIZEN", weight: 1, mayCreateEvent: true, createAsPending: false, externalIds: [], mediaHashes: [], metadata: {},
      affectedArea: box(-77, -12.5, -76.5, -12),
    });
    const id = (res as { eventId: string }).eventId;
    expect((await t.c.events.alertSnapshot(t.c.db, id))!.affectedArea).toBeNull();
  });
});

describe("área por evidencia (ADR 0144)", () => {
  it("la ficha muestra el área; fusionar la une y revertir la devuelve a cada evento", async () => {
    const now = new Date().toISOString();
    const quake = (id: string, lng: number, area: AreaGeometry): NormalizedItem => ({
      externalId: id, categoryCode: "natural.earthquake", point: { lat: -5, lng }, uncertaintyM: 5000, occurredAt: now, publishedAt: now,
      title: { es: "Sismo" }, severity: 4, assertion: "OCCURRING", area, raw: {},
    });
    const idOf = async (item: NormalizedItem) => ((await t.c.ingestion.ingest("usgs-earthquakes", item, "NORMAL")).resolution as { eventId: string }).eventId;
    const a = await idOf(quake("area-m-a", -75, box(-75.1, -5.1, -74.9, -4.9)));
    const b = await idOf(quake("area-m-b", -60, box(-60.1, -5.1, -59.9, -4.9)));
    expect(b).not.toBe(a);
    await t.c.dispatcher.drain();
    const polygons = async (id: string) => ((await t.app.inject({ url: `/v1/events/${id}` })).json().affectedArea as { coordinates: unknown[] } | null)?.coordinates.length ?? 0;
    expect(await polygons(a)).toBe(1);

    await withTransaction(t.c.db, (tx) => t.c.events.merge(tx, a, b, "test", "prueba de área"));
    expect(await polygons(a)).toBe(2);
    const mergeId = (await t.c.db.query<{ id: string }>(`SELECT id FROM event.merge_log WHERE target_event_id = $1`, [a])).rows[0]!.id;
    await withTransaction(t.c.db, (tx) => t.c.events.revertMerge(tx, mergeId, "00000000-0000-4000-8000-000000000001", "no eran el mismo"));
    expect(await polygons(a)).toBe(1);
    expect(await polygons(b)).toBe(1);
  });
});
