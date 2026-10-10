import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dailyJobs, hourlyJobs } from "../src/maintenance.js";
import { createTestContext, createUser, LIMA, offset, reportBody, submit, type TestContext, type TestUser } from "./helpers.js";
import { clone, scansDuring } from "./query-plans.js";

/**
 * Escrituras y trabajos en segundo plano con volumen (ADR 0311). Mismo método que ADR 0309 y 0310, sobre el camino
 * de un reporte (comprobación, coincidencia con eventos, verificación, alertas, feed) y sobre los trabajos de cada
 * hora y de cada día: ninguna consulta que busca filas puede recorrer entera una tabla grande. NO AI REQUIRED.
 */
const EVENTS = 20_000;
const REPORTS = 40_000;
const ZONES = 20_000;
const BIG = new Set([
  "event.events", "event.evidence", "event.timeline", "report.reports", "report.presence_evidence", "social.posts",
  "social.post_event_links", "social.event_signals", "social.follows", "alert.alerts", "alert.notifications",
  "alert.zones", "alert.subscriptions", "alert.last_locations", "trust.contributions",
]);

let t: TestContext;
let users: TestUser[];
let eventId: string;

beforeAll(async () => {
  t = await createTestContext();
  users = [];
  for (let i = 0; i < 6; i++) users.push(await createUser(t, `esc_${i}`));
  const u = users[0]!;
  await t.app.inject({ method: "POST", url: "/v1/me/zones", headers: { authorization: `Bearer ${users[1]!.token}` }, payload: { kind: "HOME", ...offset(LIMA, 3000), radiusKm: 2 } });
  await t.app.inject({ method: "POST", url: "/v1/me/alert-subscriptions", headers: { authorization: `Bearer ${users[1]!.token}` }, payload: { categoryCode: "fire", areaId: "PE" } });
  await t.app.inject({ method: "PUT", url: "/v1/me/alert-preferences", headers: { authorization: `Bearer ${users[1]!.token}` }, payload: { savedZones: true, nearMe: true } });
  await t.app.inject({ method: "PUT", url: "/v1/me/approximate-location", headers: { authorization: `Bearer ${users[1]!.token}` }, payload: { lat: LIMA.lat, lng: LIMA.lng } });
  const r = await submit(t, u, reportBody(u, { category: "fire.structure", pin: offset(LIMA, 3000), text: "Humo en el mercado" }));
  await t.c.dispatcher.drain();
  await t.c.alerts.flush();
  eventId = r.body.eventId!;
  await seedVolume(r.body.reportId!, r.body.postId!);
}, 240_000);
afterAll(async () => { await t.close(); });

async function seedVolume(reportId: string, postId: string): Promise<void> {
  const db = await t.c.db.connect();
  try {
    await db.query(`SELECT setseed(0.42)`);
    const point = (lat: string, lng: string) => `ST_AsEWKT(ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326))`;
    // Eventos por todo Perú; uno de cada veinte en Lima, para que la búsqueda cercana tenga con qué competir. Como en
    // producción, la mayoría ya terminó: 10 % activos, 5 % en seguimiento, el resto resueltos o archivados.
    await db.query(`CREATE TEMP TABLE vol_ev AS
      SELECT g AS n, gen_random_uuid() AS id, now() - random() * interval '30 days' AS at,
             CASE WHEN g % 20 = 0 THEN ${LIMA.lat} + (random() - 0.5) * 0.4 ELSE -18 + random() * 17.5 END AS lat,
             CASE WHEN g % 20 = 0 THEN ${LIMA.lng} + (random() - 0.5) * 0.4 ELSE -81 + random() * 12 END AS lng
        FROM generate_series(1, ${EVENTS}) g`);
    await clone(db, "event.events", `'id', v.id, 'geom', ${point("v.lat", "v.lng")}, 'public_geom', ${point("v.lat", "v.lng")},
        'public_h3', h3_lat_lng_to_cell(point(v.lng, v.lat), 8)::text, 'h3_r7', h3_lat_lng_to_cell(point(v.lng, v.lat), 7)::text,
        'h3_r9', h3_lat_lng_to_cell(point(v.lng, v.lat), 9)::text, 'status', CASE WHEN v.n % 20 IN (0, 1) THEN 'ACTIVE' WHEN v.n % 20 = 2 THEN 'MONITORING' WHEN v.n % 2 = 0 THEN 'RESOLVED' ELSE 'ARCHIVED' END,
        'occurred_start', v.at, 'first_seen_at', v.at, 'last_activity_at', v.at, 'created_at', v.at, 'updated_at', v.at,
        'resolved_at', CASE WHEN v.n % 20 > 2 THEN v.at END`,
      `vol_ev v CROSS JOIN (SELECT * FROM event.events WHERE id = $1) s`, [eventId]);
    await clone(db, "event.timeline", `'id', gen_random_uuid(), 'event_id', v.id, 'at', v.at`,
      `vol_ev v CROSS JOIN (SELECT * FROM event.timeline WHERE event_id = $1) s`, [eventId]);
    await clone(db, "social.event_signals", `'event_id', v.id, 'public_point', ${point("v.lat", "v.lng")}`,
      `vol_ev v CROSS JOIN (SELECT * FROM social.event_signals WHERE event_id = $1) s`, [eventId]);

    // Reportes de otras personas, dos por evento, con su presencia, evidencia, post y aporte de reputación.
    await db.query(`CREATE TEMP TABLE vol_rep AS
      SELECT g AS n, gen_random_uuid() AS id, gen_random_uuid() AS author, gen_random_uuid() AS post, e.id AS event_id, e.lat, e.lng, e.at
        FROM generate_series(1, ${REPORTS}) g JOIN vol_ev e ON e.n = 1 + g % ${EVENTS}`);
    await clone(db, "report.reports", `'id', v.id, 'author_user_id', v.author, 'author_profile_id', gen_random_uuid(), 'client_report_id', gen_random_uuid(),
        'post_id', v.post, 'event_id', v.event_id, 'pin', ${point("v.lat", "v.lng")},
        'pin_h3_r9', h3_lat_lng_to_cell(point(v.lng, v.lat), 9)::text, 'received_at', v.at, 'captured_at', v.at`,
      `vol_rep v CROSS JOIN (SELECT * FROM report.reports WHERE id = $1) s`, [reportId]);
    // Pasados los 7 días la ubicación precisa ya se generalizó: sin fix y con fecha de generalización.
    await clone(db, "report.presence_evidence", `'report_id', v.id, 'expires_at', v.at + interval '7 days',
        'fix_h3_r7', h3_lat_lng_to_cell(point(v.lng, v.lat), 7)::text,
        'device_fix', CASE WHEN v.at > now() - interval '7 days' THEN s.device_fix END,
        'device_fix_enc', CASE WHEN v.at > now() - interval '7 days' THEN s.device_fix_enc END,
        'generalized_at', CASE WHEN v.at <= now() - interval '7 days' THEN v.at + interval '7 days' END`,
      `vol_rep v CROSS JOIN (SELECT * FROM report.presence_evidence WHERE report_id = $1) s`, [reportId]);
    await clone(db, "event.evidence", `'id', gen_random_uuid(), 'event_id', v.event_id, 'ref_id', v.id, 'observed_at', v.at, 'added_at', v.at,
        'point', ${point("v.lat", "v.lng")}, 'contributor_user_id', v.author, 'contributor_device_id', gen_random_uuid()`,
      `vol_rep v CROSS JOIN (SELECT * FROM event.evidence WHERE evidence_type = 'CITIZEN_REPORT' AND ref_id = $1) s`, [reportId]);
    await clone(db, "social.posts", `'id', v.post, 'author_id', ($2::uuid[])[1 + v.n % cardinality($2::uuid[])], 'client_id', NULL,
        'text', 'Reporte de volumen ' || v.n, 'text_hash', md5('Reporte de volumen ' || v.n), 'public_point', ${point("v.lat", "v.lng")},
        'created_at', v.at, 'updated_at', v.at`,
      `vol_rep v CROSS JOIN (SELECT * FROM social.posts WHERE id = $1) s`, [postId, users.map((u) => u.profileId)]);
    await db.query(`INSERT INTO social.post_event_links (post_id, event_id, link_type, created_at) SELECT post, event_id, 'REPORT', at FROM vol_rep`);
    await clone(db, "trust.contributions", `'user_id', v.author, 'event_id', v.event_id, 'created_at', v.at`,
      `vol_rep v CROSS JOIN (SELECT * FROM trust.contributions LIMIT 1) s`, []);

    // Alertas: zonas, suscripciones y ubicaciones aproximadas de otras personas por todo Perú; avisos ya enviados.
    await db.query(`CREATE TEMP TABLE vol_zone AS
      SELECT g AS n, gen_random_uuid() AS profile, -18 + random() * 17.5 AS lat, -81 + random() * 12 AS lng FROM generate_series(1, ${ZONES}) g`);
    await clone(db, "alert.zones", `'id', gen_random_uuid(), 'profile_id', v.profile, 'center', ${point("v.lat", "v.lng")}`,
      `vol_zone v CROSS JOIN (SELECT * FROM alert.zones LIMIT 1) s`, []);
    await clone(db, "alert.subscriptions", `'id', gen_random_uuid(), 'profile_id', v.profile, 'area_id', 'PE-' || (v.n % 25)`,
      `vol_zone v CROSS JOIN (SELECT * FROM alert.subscriptions LIMIT 1) s`, []);
    await clone(db, "alert.last_locations", `'profile_id', v.profile, 'center', ${point("v.lat", "v.lng")}, 'seen_at', now() - random() * interval '72 hours'`,
      `vol_zone v CROSS JOIN (SELECT * FROM alert.last_locations LIMIT 1) s`, []);
    await db.query(`CREATE TEMP TABLE vol_alert AS SELECT g AS n, gen_random_uuid() AS id, e.id AS event_id, e.at FROM generate_series(1, ${EVENTS}) g JOIN vol_ev e ON e.n = g`);
    // Un aviso ya enviado por evento, a tres personas cada uno; uno de cada mil todavía pendiente (el envío corre cada pocos segundos).
    await db.query(`INSERT INTO alert.alerts (id, event_id, kind, dedup_key, category_code, severity, critical, created_at, origin)
      SELECT v.id, v.event_id, 'NEW_EVENT', 'vol:' || v.n, 'fire.structure', 3, v.n % 50 = 0, v.at, 'SYSTEM' FROM vol_alert v`);
    await db.query(`INSERT INTO alert.notifications (id, alert_id, profile_id, user_id, match, title, body, status, created_at)
      SELECT gen_random_uuid(), v.id, gen_random_uuid(), gen_random_uuid(), 'SAVED_ZONE', 'Incendio', 'Cerca de tu zona',
             CASE WHEN v.n % 1000 = 0 AND k = 1 THEN 'PENDING' ELSE 'SENT' END, v.at
        FROM vol_alert v CROSS JOIN generate_series(1, 3) k`);
    await db.query(`INSERT INTO social.follows (follower_profile_id, target_type, target_id)
      SELECT f, 'EVENT', e.id::text FROM vol_ev e CROSS JOIN unnest($1::uuid[]) f`, [users.slice(2).map((u) => u.profileId)]);

    for (const table of BIG) await db.query(`ANALYZE ${table}`);
  } finally {
    db.release();
  }
}

describe("escrituras y trabajos con volumen", () => {
  it("el volumen quedó cargado", async () => {
    const n = async (sql: string) => (await t.c.db.query<{ n: number }>(sql)).rows[0]!.n;
    expect(await n(`SELECT count(*)::int AS n FROM event.events`)).toBeGreaterThan(EVENTS);
    expect(await n(`SELECT count(*)::int AS n FROM report.reports`)).toBeGreaterThan(REPORTS);
    expect(await n(`SELECT count(*)::int AS n FROM alert.zones`)).toBeGreaterThan(ZONES);
    expect(await n(`SELECT count(*)::int AS n FROM alert.last_locations`)).toBeGreaterThan(ZONES);
    expect(await n(`SELECT count(*)::int AS n FROM trust.contributions`)).toBeGreaterThan(REPORTS);
    expect(await n(`SELECT count(*)::int AS n FROM alert.notifications`)).toBeGreaterThan(EVENTS);
  });

  it("reportar y corroborar, con verificación, alertas y feed", async () => {
    const r = await scansDuring(t, async () => {
      const a = await submit(t, users[2]!, reportBody(users[2]!, { category: "fire.structure", pin: offset(LIMA, -2000), text: "Incendio en la avenida" }));
      expect(a.status).toBe(200);
      await t.c.dispatcher.drain();
      const b = await submit(t, users[3]!, reportBody(users[3]!, { category: "fire.structure", pin: offset(LIMA, -2050), text: "Se ve el fuego desde aquí" }));
      expect(b.body.eventId).toBe(a.body.eventId);
      await t.c.dispatcher.drain();
      await t.c.alerts.flush();
    }, BIG);
    expect(r.queries).toBeGreaterThan(20);
    expect(r.scans).toEqual([]);
  });

  const jobs = () => [...hourlyJobs(t.c), ...dailyJobs(t.c)];
  for (const name of ["events.lifecycle", "events.source-end", "events.archive", "moderation.priorities", "events.duplicates",
    "retention.presence.generalized", "retention.presence.legacy-fixes", "retention.identity", "retention.alerts",
    "retention.media", "retention.source-items", "trust.standing.refresh", "retention.outbox"]) {
    it(`trabajo ${name}: sin recorrer tablas grandes`, async () => {
      const job = jobs().find(([n]) => n === name);
      expect(job, name).toBeTruthy();
      const r = await scansDuring(t, job![1], BIG);
      expect(r.scans).toEqual([]);
    });
  }
});
