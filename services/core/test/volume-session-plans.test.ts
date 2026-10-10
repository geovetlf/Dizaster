import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, LIMA, offset, reportBody, submit, type TestContext, type TestUser } from "./helpers.js";
import { clone, scansOf as plans } from "./query-plans.js";

/**
 * Lecturas con sesión y de moderación con volumen (ADR 0310). Mismo método que ADR 0309: filas reales creadas por la
 * API, clonadas por miles (la mayoría de otras personas), y el plan de cada SELECT que lanza la petición. Ninguna
 * puede recorrer entera una tabla grande. NO AI REQUIRED.
 */
const REPORTS = 40_000;
const NOTIFICATIONS = 60_000;
const CASES = 20_000;
const EVENTS = 10_000;
const BIG = new Set([
  "alert.alerts", "alert.notifications", "report.reports", "report.presence_evidence", "report.presence_access_log",
  "event.events", "event.evidence", "event.dedup_reviews", "event.duplicate_candidates", "event.timeline",
  "moderation.cases", "moderation.flags", "moderation.actions", "moderation.appeals", "social.follows",
]);

let t: TestContext;
let reporter: TestUser;
let notified: TestUser;
let mod: TestUser;
let caseId: string;
let eventId: string;
const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });

async function asRole(handle: string, role: "moderator" | "admin"): Promise<TestUser> {
  const u = await createUser(t, handle);
  await t.c.identity.grantRole(u.userId, role);
  const token = (await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle, platform: "ANDROID", deviceId: u.deviceId } })).json().token as string;
  return { ...u, token };
}

beforeAll(async () => {
  t = await createTestContext();
  reporter = await createUser(t, "ses_reporta");
  notified = await createUser(t, "ses_avisada");
  mod = await asRole("ses_mod", "admin");
  const flagger = await createUser(t, "ses_denuncia");
  // Plantillas reales: reporte con presencia y evidencia, mención (aviso), denuncia (caso), acción y apelación.
  const r = await submit(t, reporter, reportBody(reporter, { category: "fire.structure", pin: offset(LIMA, 3000), text: "Humo en el mercado" }));
  const handle = (await t.c.db.query<{ handle: string }>(`SELECT handle FROM social.profiles WHERE id = $1`, [notified.profileId])).rows[0]!.handle;
  await t.app.inject({ method: "POST", url: "/v1/posts", headers: auth(reporter), payload: { text: `Atenta @${handle}` } });
  await t.c.dispatcher.drain();
  await t.c.alerts.flush();
  eventId = r.body.eventId!;
  await t.app.inject({ method: "POST", url: "/v1/flags", headers: auth(flagger), payload: { targetType: "POST", targetId: r.body.postId, reason: "SPAM" } });
  caseId = (await t.app.inject({ url: "/v1/moderation/cases", headers: auth(mod) })).json().cases[0].id;
  await t.app.inject({ method: "POST", url: `/v1/moderation/cases/${caseId}/actions`, headers: auth(mod), payload: { action: "LIMIT", reason: "Incumple las normas de la comunidad" } });
  await t.c.dispatcher.drain();
  const notice = (await t.app.inject({ url: "/v1/me/moderation", headers: auth(reporter) })).json().notices[0];
  const appeal = await t.app.inject({ method: "POST", url: `/v1/me/moderation/${notice.action.id}/appeal`, headers: auth(reporter), payload: { text: "No es spam, es un aviso real del barrio" } });
  if (appeal.statusCode !== 201) throw new Error(`apelación: ${appeal.statusCode} ${appeal.body}`);
  await seedVolume();
}, 240_000);
afterAll(async () => { await t.close(); });

async function seedVolume(): Promise<void> {
  const db = await t.c.db.connect();
  try {
    await db.query(`SELECT setseed(0.42)`);
    const one = async (sql: string, values: unknown[] = []) => (await db.query<{ id: string }>(sql, values)).rows[0]!.id;
    const alertId = await one(`SELECT id FROM alert.alerts ORDER BY created_at LIMIT 1`);
    const notificationId = await one(`SELECT id FROM alert.notifications WHERE profile_id = $1`, [notified.profileId]);
    const reportId = await one(`SELECT id FROM report.reports WHERE author_user_id = $1`, [reporter.userId]);
    const actionId = await one(`SELECT id FROM moderation.actions WHERE case_id = $1`, [caseId]);

    // Eventos, para la cola de duplicados (una cola corta: 1 % abiertos) y la ficha de moderación.
    await db.query(`CREATE TEMP TABLE vol_ev AS SELECT g AS n, gen_random_uuid() AS id, now() - random() * interval '30 days' AS at FROM generate_series(1, ${EVENTS}) g`);
    await clone(db, "event.events", `'id', v.id, 'created_at', v.at, 'last_activity_at', v.at, 'first_seen_at', v.at`,
      `vol_ev v CROSS JOIN (SELECT * FROM event.events WHERE id = $1) s`, [eventId]);
    await clone(db, "event.timeline", `'id', gen_random_uuid(), 'event_id', v.id, 'at', v.at`,
      `vol_ev v CROSS JOIN (SELECT * FROM event.timeline WHERE event_id = $1) s`, [eventId]);
    await db.query(`INSERT INTO event.duplicate_candidates (id, event_a, event_b, score, reason, status, created_at)
      SELECT gen_random_uuid(), least(a.id, b.id), greatest(a.id, b.id), 0.8, 'AMBIGUOUS_SCORE', CASE WHEN a.n % 100 = 0 THEN 'OPEN' ELSE 'DISMISSED' END, a.at
        FROM vol_ev a JOIN vol_ev b ON b.n = a.n + 1`);

    // Avisos: 60 000, de ellos 3000 de la persona avisada; el resto de otras personas.
    await db.query(`CREATE TEMP TABLE vol_alert AS SELECT g AS n, gen_random_uuid() AS id, now() - random() * interval '30 days' AS at FROM generate_series(1, ${NOTIFICATIONS / 3}) g`);
    await clone(db, "alert.alerts", `'id', v.id, 'dedup_key', 'vol:' || v.n, 'created_at', v.at`,
      `vol_alert v CROSS JOIN (SELECT * FROM alert.alerts WHERE id = $1) s`, [alertId]);
    await clone(db, "alert.notifications", `
        'id', gen_random_uuid(), 'alert_id', v.id, 'created_at', v.at + k * interval '1 second',
        'profile_id', CASE WHEN v.n % 20 = 0 AND k = 0 THEN $2::uuid ELSE gen_random_uuid() END,
        'read_at', CASE WHEN v.n % 2 = 0 THEN v.at END`,
      `vol_alert v CROSS JOIN generate_series(0, 2) k CROSS JOIN (SELECT * FROM alert.notifications WHERE id = $1) s`, [notificationId, notified.profileId]);

    // Reportes: 40 000, 2000 de quien reporta; cada uno con presencia y evidencia; cada uno con su revisión "¿es el mismo?" (un tercio abiertas).
    await db.query(`CREATE TEMP TABLE vol_rep AS
      SELECT g AS n, gen_random_uuid() AS id, CASE WHEN g % 20 = 0 THEN $1::uuid ELSE gen_random_uuid() END AS author,
             now() - random() * interval '30 days' AS at, (SELECT id FROM vol_ev WHERE n = 1 + g % ${EVENTS}) AS event_id
        FROM generate_series(1, ${REPORTS}) g`, [reporter.userId]);
    await clone(db, "report.reports", `'id', v.id, 'author_user_id', v.author, 'client_report_id', gen_random_uuid(), 'post_id', gen_random_uuid(),
        'event_id', v.event_id, 'received_at', v.at, 'captured_at', v.at`,
      `vol_rep v CROSS JOIN (SELECT * FROM report.reports WHERE id = $1) s`, [reportId]);
    await clone(db, "report.presence_evidence", `'report_id', v.id, 'expires_at', v.at + interval '7 days'`,
      `vol_rep v CROSS JOIN (SELECT * FROM report.presence_evidence WHERE report_id = $1) s`, [reportId]);
    await clone(db, "event.evidence", `'id', gen_random_uuid(), 'event_id', v.event_id, 'ref_id', v.id, 'observed_at', v.at, 'added_at', v.at`,
      `vol_rep v CROSS JOIN (SELECT * FROM event.evidence WHERE evidence_type = 'CITIZEN_REPORT' AND ref_id = $1) s`, [reportId]);
    await db.query(`INSERT INTO event.dedup_reviews (id, evidence_id, candidates, status, created_at)
      SELECT gen_random_uuid(), e.id, '[]', CASE WHEN r.n % 3 = 0 THEN 'OPEN' ELSE 'CONFIRMED' END, r.at
        FROM vol_rep r JOIN event.evidence e ON e.evidence_type = 'CITIZEN_REPORT' AND e.ref_id = r.id`);
    await db.query(`INSERT INTO report.presence_access_log (id, report_id, actor_user_id, reason, precise_shown, accessed_at)
      SELECT gen_random_uuid(), r.id, $1, 'Revisión de presencia por denuncia', false, r.at FROM vol_rep r WHERE r.n % 5 = 0`, [mod.userId]);

    // Moderación: 20 000 casos (un tercio abiertos), 3 denuncias por caso, una acción por caso cerrado, apelaciones.
    await db.query(`CREATE TEMP TABLE vol_case AS
      SELECT g AS n, gen_random_uuid() AS id, now() - random() * interval '30 days' AS at, g % 3 = 0 AS open
        FROM generate_series(1, ${CASES}) g`);
    await clone(db, "moderation.cases", `'id', v.id, 'target_id', gen_random_uuid(), 'opened_at', v.at, 'updated_at', v.at,
        'priority', (v.n % 50)::real, 'status', CASE WHEN v.open THEN 'OPEN' ELSE 'RESOLVED' END,
        'resolved_at', CASE WHEN v.open THEN NULL ELSE v.at + interval '1 hour' END, 'claimed_by', NULL, 'claimed_until', NULL`,
      `vol_case v CROSS JOIN (SELECT * FROM moderation.cases WHERE id = $1) s`, [caseId]);
    await clone(db, "moderation.flags", `'id', gen_random_uuid(), 'case_id', v.id, 'target_id', gen_random_uuid(), 'reporter_profile_id', gen_random_uuid(), 'created_at', v.at`,
      `vol_case v CROSS JOIN generate_series(1, 3) k CROSS JOIN (SELECT * FROM moderation.flags WHERE case_id = $1) s`, [caseId]);
    await db.query(`CREATE TEMP TABLE vol_action AS SELECT gen_random_uuid() AS id, c.id AS case_id, c.n, c.at FROM vol_case c WHERE NOT c.open`);
    await clone(db, "moderation.actions", `'id', v.id, 'case_id', v.case_id, 'target_id', gen_random_uuid(), 'created_at', v.at,
        'affected_user_id', CASE WHEN v.n % 40 = 0 THEN $2::uuid ELSE gen_random_uuid() END`,
      `vol_action v CROSS JOIN (SELECT * FROM moderation.actions WHERE id = $1) s`, [actionId, reporter.userId]);
    await clone(db, "moderation.appeals", `'id', gen_random_uuid(), 'action_id', v.id, 'appellant_user_id', gen_random_uuid(), 'created_at', v.at,
        'status', CASE WHEN v.n % 2 = 0 THEN 'OPEN' ELSE 'UPHELD' END`,
      `(SELECT * FROM vol_action WHERE n % 4 = 0) v CROSS JOIN (SELECT * FROM moderation.appeals LIMIT 1) s`, []);

    // Seguimientos de otras personas: cada evento lo siguen dos.
    await db.query(`INSERT INTO social.follows (follower_profile_id, target_type, target_id)
      SELECT f, 'EVENT', e.id::text FROM vol_ev e CROSS JOIN unnest($1::uuid[]) f`, [[notified.profileId, mod.profileId]]);

    for (const table of BIG) await db.query(`ANALYZE ${table}`);
  } finally {
    db.release();
  }
}

const scansOf = (url: string, user: TestUser) => plans(t, url, BIG, user);

describe("lecturas con sesión y de moderación con volumen", () => {
  it("el volumen quedó cargado", async () => {
    const n = async (sql: string) => (await t.c.db.query<{ n: number }>(sql)).rows[0]!.n;
    expect(await n(`SELECT count(*)::int AS n FROM alert.notifications`)).toBeGreaterThanOrEqual(NOTIFICATIONS);
    expect(await n(`SELECT count(*)::int AS n FROM report.reports`)).toBeGreaterThan(REPORTS);
    expect(await n(`SELECT count(*)::int AS n FROM moderation.cases`)).toBeGreaterThan(CASES);
    expect(await n(`SELECT count(*)::int AS n FROM moderation.appeals`)).toBeGreaterThan(1000);
    expect(await n(`SELECT count(*)::int AS n FROM event.dedup_reviews`)).toBeGreaterThan(1000);
  });

  const reads: [string, () => string, () => TestUser][] = [
    ["notificaciones", () => "/v1/me/notifications", () => notified],
    ["mis reportes", () => "/v1/me/reports", () => reporter],
    ["mis avisos de moderación", () => "/v1/me/moderation", () => reporter],
    ["mi perfil", () => "/v1/me", () => reporter],
    ["a quién sigo", () => "/v1/me/follows", () => reporter],
    ["zonas", () => "/v1/me/zones", () => reporter],
    ["suscripciones", () => "/v1/me/alert-subscriptions", () => reporter],
    ["bloqueos", () => "/v1/me/blocks", () => reporter],
    ["sesiones", () => "/v1/me/sessions", () => reporter],
    ["cola de moderación", () => "/v1/moderation/cases", () => mod],
    ["detalle del caso", () => `/v1/moderation/cases/${caseId}`, () => mod],
    ["apelaciones", () => "/v1/moderation/appeals", () => mod],
    ["evento en moderación", () => `/v1/moderation/events/${eventId}`, () => mod],
    ["cola de duplicados", () => "/v1/moderation/duplicates", () => mod],
    ["registro de acciones", () => "/v1/admin/moderation-actions", () => mod],
    ["registro de acceso a presencia", () => "/v1/admin/presence-access", () => mod],
  ];
  it.each(reads)("%s: sin recorrer tablas grandes", async (_name, url, user) => {
    const r = await scansOf(url(), user());
    expect(r.status).toBe(200);
    expect(r.queries).toBeGreaterThan(0);
    expect(r.scans).toEqual([]);
  });

  // ADR 0312: una página de la cola o de apelaciones no lanza consultas por fila salvo la vista previa del objeto
  // (casi todos los objetos clonados no existen y su vista previa es una sola consulta; el de la plantilla es real y
  // puede sumar un par). Antes la cola leía cada caso y sus motivos aparte: tres consultas por caso.
  it.each([
    ["cola de moderación", "/v1/moderation/cases"],
    ["apelaciones", "/v1/moderation/appeals"],
  ])("%s: cada fila más cuesta como mucho una consulta", async (_name, base) => {
    const small = await scansOf(`${base}?limit=10`, mod);
    const large = await scansOf(`${base}?limit=50`, mod);
    expect(small.status).toBe(200);
    expect(large.status).toBe(200);
    expect(large.queries - small.queries).toBeLessThanOrEqual(40 + 2);
    expect(large.scans).toEqual([]);
  });
});

