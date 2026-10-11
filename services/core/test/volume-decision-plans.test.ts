import type { ProfileView } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hourlyJobs, dailyJobs } from "../src/maintenance.js";
import { createTestContext, createUser, LIMA, offset, reportBody, submit, type TestContext, type TestUser } from "./helpers.js";
import { clone, rowsReadDuring, scansDuring, scansOf } from "./query-plans.js";

/**
 * Lo añadido el 2026-10-11 (ADR 0317–0321) y la salud de fuentes, con volumen (ADR 0322). Mismo método que ADR
 * 0309–0313: filas reales creadas por la API, clonadas por miles, y el plan de cada consulta. Cubre el aviso de un
 * comentario (contexto, tope diario y envío), el fin de las suspensiones, «N reportes corroborados» en el perfil y la
 * vista de fuentes de administración con meses de corridas. NO AI REQUIRED.
 */
const USERS = 20_000;
const POSTS = 40_000;
const COMMENTS = 40_000;
const ALERTS = 20_000;
const EVENTS = 10_000;
const REPORTS = 40_000;
const CAP = 20;
const RUN_EVERY_MIN = 10;
const RUN_DAYS = 92;
const BIG = new Set([
  "identity.users", "social.profiles", "social.posts", "social.comments", "alert.alerts", "alert.notifications",
  "moderation.actions", "report.reports", "event.evidence", "event.events", "ingestion.runs",
]);

let t: TestContext;
let autora: TestUser;
let otra: TestUser;
let vecino: TestUser;
let reportera: TestUser;
let admin: TestUser;
let postId: string;
let otraCommentId: string;
/** Cuentas cuya suspensión ya venció → objeto de su última suspensión. */
const lastTarget = new Map<string, string>();
const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });
const handleOf = async (u: TestUser) => (await t.c.db.query<{ handle: string }>(`SELECT handle FROM social.profiles WHERE id = $1`, [u.profileId])).rows[0]!.handle;

async function asRole(handle: string, role: "moderator" | "admin"): Promise<TestUser> {
  const u = await createUser(t, handle);
  await t.c.identity.grantRole(u.userId, role);
  const token = (await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle, platform: "ANDROID", deviceId: u.deviceId } })).json().token as string;
  return { ...u, token };
}
async function comment(u: TestUser, post: string, text: string, parentId?: string): Promise<string> {
  const res = await t.app.inject({ method: "POST", url: `/v1/posts/${post}/comments`, headers: auth(u), payload: { text, ...(parentId ? { parentId } : {}) } });
  if (res.statusCode !== 201) throw new Error(`comentario: ${res.statusCode} ${res.body}`);
  return (res.json() as { id: string }).id;
}

beforeAll(async () => {
  t = await createTestContext({ env: { SOCIAL_NOTICES_PER_DAY: String(CAP) } });
  autora = await createUser(t, "dec_autora");
  otra = await createUser(t, "dec_otra");
  vecino = await createUser(t, "dec_vecino");
  reportera = await createUser(t, "dec_reporta");
  const b = await createUser(t, "dec_b");
  const c = await createUser(t, "dec_c");
  const sancionada = await createUser(t, "dec_sancion");
  const flagger = await createUser(t, "dec_denuncia");
  admin = await asRole("dec_admin", "admin");

  // Plantillas reales. Avisos de comentarios activados (ADR 0320): un comentario de `otra` avisa a la autora.
  for (const u of [autora, otra]) {
    const res = await t.app.inject({ method: "PUT", url: "/v1/me/alert-preferences", headers: auth(u), payload: { comments: true, replies: true } });
    if (res.statusCode !== 200) throw new Error(`preferencias: ${res.statusCode} ${res.body}`);
  }
  const p = await t.app.inject({ method: "POST", url: "/v1/posts", headers: auth(autora), payload: { text: "Se fue la luz en el barrio" } });
  postId = (p.json() as { postId: string }).postId;
  otraCommentId = await comment(otra, postId, "Aquí también");
  await t.c.dispatcher.drain();
  await t.c.alerts.flush();

  // Un evento corroborado por tres personas (ADR 0321).
  const pin = offset(LIMA, 0, 30000);
  const r = await submit(t, reportera, reportBody(reportera, { pin }));
  await submit(t, b, reportBody(b, { pin: offset(pin, 20) }));
  await submit(t, c, reportBody(c, { pin: offset(pin, -20) }));
  await t.c.dispatcher.drain();

  // Una suspensión de 24 horas (ADR 0319).
  const s = await submit(t, sancionada, reportBody(sancionada, { category: "infra.power_outage", pin: offset(LIMA, 2000, 3000), text: "Mensaje amenazante" }));
  await t.app.inject({ method: "POST", url: "/v1/flags", headers: auth(flagger), payload: { targetType: "POST", targetId: s.body.postId, reason: "HARASSMENT" } });
  const cases = (await t.app.inject({ url: "/v1/moderation/cases?limit=50", headers: auth(admin) })).json().cases as { id: string; target: { id: string } }[];
  const caseId = cases.find((x) => x.target.id === s.body.postId)!.id;
  const act = await t.app.inject({ method: "POST", url: `/v1/moderation/cases/${caseId}/actions`, headers: auth(admin),
    payload: { action: "SUSPEND_USER", suspension: "HOURS_24", reason: "Amenazas reiteradas a otras personas" } });
  if (act.statusCode !== 200) throw new Error(`suspensión: ${act.statusCode} ${act.body}`);
  await t.c.dispatcher.drain();

  await seedVolume(r.body.reportId!, r.body.eventId!, sancionada);
}, 300_000);
afterAll(async () => { await t.close(); });

async function seedVolume(reportId: string, eventId: string, sancionada: TestUser): Promise<void> {
  const db = await t.c.db.connect();
  try {
    await db.query(`SELECT setseed(0.42)`);
    const one = async (sql: string, values: unknown[] = []) => (await db.query<{ id: string }>(sql, values)).rows[0]!.id;
    const alertId = await one(`SELECT id FROM alert.alerts WHERE kind = 'COMMENT' LIMIT 1`);
    const notificationId = await one(`SELECT id FROM alert.notifications WHERE profile_id = $1 AND match = 'COMMENTED'`, [autora.profileId]);
    const actionId = await one(`SELECT id FROM moderation.actions WHERE affected_user_id = $1 AND action = 'SUSPEND_USER'`, [sancionada.userId]);

    // Cuentas y perfiles: uno de cada ocho suspendido. De ellos, uno de cada diez ya cumplió su plazo; uno de cada
    // dos de los demás es permanente (sin plazo).
    await db.query(`CREATE TEMP TABLE vol_user AS
      SELECT g AS n, gen_random_uuid() AS uid, gen_random_uuid() AS pid, gen_random_uuid() AS last_target,
             CASE WHEN g % 80 = 0 THEN now() - interval '1 hour' WHEN g % 16 = 0 THEN now() + interval '3 days' END AS until,
             g % 8 = 0 AS suspended
        FROM generate_series(1, ${USERS}) g`);
    await clone(db, "identity.users", `'id', v.uid, 'status', CASE WHEN v.suspended THEN 'SUSPENDED' ELSE 'ACTIVE' END,
        'suspended_until', v.until, 'roles', '{}'::text[]`,
      `vol_user v CROSS JOIN (SELECT * FROM identity.users WHERE id = $1) s`, [sancionada.userId]);
    await clone(db, "social.profiles", `'id', v.pid, 'user_id', v.uid, 'handle', 'vol_' || v.n, 'display_name', 'Vecina ' || v.n`,
      `vol_user v CROSS JOIN (SELECT * FROM social.profiles WHERE id = $1) s`, [autora.profileId]);
    // Dos suspensiones por cuenta suspendida (la última manda) y otras 20 000 acciones sobre otras personas.
    await clone(db, "moderation.actions", `'id', gen_random_uuid(), 'affected_user_id', v.uid,
        'target_id', CASE WHEN k = 1 THEN v.last_target ELSE gen_random_uuid() END,
        'created_at', CASE WHEN k = 1 THEN now() - interval '2 days' ELSE now() - interval '40 days' END`,
      `(SELECT * FROM vol_user WHERE suspended) v CROSS JOIN generate_series(0, 1) k CROSS JOIN (SELECT * FROM moderation.actions WHERE id = $1) s`, [actionId]);
    await clone(db, "moderation.actions", `'id', gen_random_uuid(), 'affected_user_id', gen_random_uuid(), 'target_id', gen_random_uuid(),
        'created_at', now() - (v.n % 60) * interval '1 day' - random() * interval '1 day'`,
      `vol_user v CROSS JOIN (SELECT * FROM moderation.actions WHERE id = $1) s`, [actionId]);

    // Posts y comentarios de otras personas.
    await db.query(`CREATE TEMP TABLE vol_post AS
      SELECT g AS n, gen_random_uuid() AS id, u.pid AS author, now() - random() * interval '30 days' AS at
        FROM generate_series(1, ${POSTS}) g JOIN vol_user u ON u.n = 1 + g % ${USERS}`);
    await clone(db, "social.posts", `'id', v.id, 'author_id', v.author, 'client_id', NULL, 'text', 'Publicación ' || v.n,
        'text_hash', md5('Publicación ' || v.n), 'created_at', v.at, 'updated_at', v.at`,
      `vol_post v CROSS JOIN (SELECT * FROM social.posts WHERE id = $1) s`, [postId]);
    await clone(db, "social.comments", `'id', gen_random_uuid(), 'post_id', p.id, 'author_profile_id', u.pid, 'client_id', NULL,
        'parent_comment_id', NULL, 'created_at', p.at + interval '1 minute'`,
      `generate_series(1, ${COMMENTS}) g JOIN vol_post p ON p.n = 1 + g % ${POSTS} JOIN vol_user u ON u.n = 1 + (g * 7) % ${USERS}
        CROSS JOIN (SELECT * FROM social.comments WHERE id = $1) s`, [otraCommentId]);

    // Avisos de comentarios: 20 000 alertas, tres avisos cada una (60 000), de los últimos dos días; uno de cada mil
    // pendiente de envío.
    await db.query(`CREATE TEMP TABLE vol_alert AS
      SELECT g AS n, gen_random_uuid() AS id, p.id AS post, now() - random() * interval '48 hours' AS at
        FROM generate_series(1, ${ALERTS}) g JOIN vol_post p ON p.n = g`);
    await clone(db, "alert.alerts", `'id', v.id, 'dedup_key', 'vol:' || v.n, 'post_id', v.post, 'created_at', v.at`,
      `vol_alert v CROSS JOIN (SELECT * FROM alert.alerts WHERE id = $1) s`, [alertId]);
    await clone(db, "alert.notifications", `'id', gen_random_uuid(), 'alert_id', v.id, 'profile_id', u.pid, 'user_id', u.uid,
        'match', CASE WHEN k = 0 THEN 'REPLIED' ELSE 'COMMENTED' END, 'created_at', v.at + k * interval '1 second',
        'status', CASE WHEN v.n % 1000 = 0 AND k = 0 THEN 'PENDING' ELSE 'SENT' END, 'pushed_at', NULL,
        'read_at', CASE WHEN v.n % 2 = 0 THEN v.at END`,
      `vol_alert v CROSS JOIN generate_series(0, 2) k JOIN vol_user u ON u.n = 1 + (v.n * 3 + k) % ${USERS}
        CROSS JOIN (SELECT * FROM alert.notifications WHERE id = $1) s`, [notificationId]);
    // La autora ya llegó al tope de hoy; `otra` lleva dos.
    await clone(db, "alert.notifications", `'id', gen_random_uuid(), 'alert_id', v.id, 'profile_id', $2::uuid, 'user_id', $3::uuid,
        'created_at', now() - interval '1 hour' - v.n * interval '1 minute'`,
      `(SELECT * FROM vol_alert WHERE n <= ${CAP}) v CROSS JOIN (SELECT * FROM alert.notifications WHERE id = $1) s`,
      [notificationId, autora.profileId, autora.userId]);
    await clone(db, "alert.notifications", `'id', gen_random_uuid(), 'alert_id', v.id, 'profile_id', $2::uuid, 'user_id', $3::uuid,
        'match', 'REPLIED', 'created_at', now() - interval '2 hours' - v.n * interval '1 minute'`,
      `(SELECT * FROM vol_alert WHERE n > ${CAP} AND n <= ${CAP + 2}) v CROSS JOIN (SELECT * FROM alert.notifications WHERE id = $1) s`,
      [notificationId, otra.profileId, otra.userId]);

    // Reportes y eventos (ADR 0321): 10 000 eventos (un tercio corroborados, uno de cada treinta con confirmación
    // oficial) y 40 000 reportes, uno de cada trece de la reportera; uno de cada diez con la evidencia retirada.
    await db.query(`CREATE TEMP TABLE vol_ev AS SELECT g AS n, gen_random_uuid() AS id, now() - random() * interval '30 days' AS at FROM generate_series(1, ${EVENTS}) g`);
    await clone(db, "event.events", `'id', v.id, 'created_at', v.at, 'last_activity_at', v.at, 'first_seen_at', v.at,
        'verification_level', CASE WHEN v.n % 30 = 0 THEN 'OFFICIALLY_CONFIRMED' WHEN v.n % 3 = 0 THEN 'COMMUNITY_CORROBORATED' ELSE 'UNVERIFIED' END`,
      `vol_ev v CROSS JOIN (SELECT * FROM event.events WHERE id = $1) s`, [eventId]);
    await db.query(`CREATE TEMP TABLE vol_rep AS
      SELECT g AS n, gen_random_uuid() AS id, CASE WHEN g % 13 = 0 THEN $1::uuid ELSE gen_random_uuid() END AS author,
             e.id AS event_id, e.at
        FROM generate_series(1, ${REPORTS}) g JOIN vol_ev e ON e.n = 1 + (g * 7) % ${EVENTS}`, [reportera.userId]);
    await clone(db, "report.reports", `'id', v.id, 'author_user_id', v.author, 'client_report_id', gen_random_uuid(), 'post_id', gen_random_uuid(),
        'event_id', v.event_id, 'received_at', v.at, 'captured_at', v.at`,
      `vol_rep v CROSS JOIN (SELECT * FROM report.reports WHERE id = $1) s`, [reportId]);
    await clone(db, "event.evidence", `'id', gen_random_uuid(), 'event_id', v.event_id, 'ref_id', v.id, 'observed_at', v.at, 'added_at', v.at,
        'status', CASE WHEN v.n % 10 = 0 THEN 'DETACHED' ELSE 'ACTIVE' END`,
      `vol_rep v CROSS JOIN (SELECT * FROM event.evidence WHERE evidence_type = 'CITIZEN_REPORT' AND ref_id = $1) s`, [reportId]);

    // Fuentes: una corrida cada 10 minutos por fuente durante 92 días (la retención es de 90); una de cada cuarenta
    // falla. La última fuente nunca falla.
    await db.query(`INSERT INTO ingestion.runs (id, source_id, lane, started_at, finished_at, status, items_seen, items_new, error)
      SELECT gen_random_uuid(), s.id, 'NORMAL', at, at + interval '2 seconds',
             CASE WHEN s.last OR g % 40 <> 0 THEN 'OK' ELSE 'FAILED' END, 10, g % 3,
             CASE WHEN NOT s.last AND g % 40 = 0 THEN 'HTTP 503' END
        FROM (SELECT id, row_number() OVER (ORDER BY key DESC) = 1 AS last FROM ingestion.sources) s
        CROSS JOIN generate_series(1, ${(RUN_DAYS * 24 * 60) / RUN_EVERY_MIN}) g
        CROSS JOIN LATERAL (SELECT now() - g * interval '${RUN_EVERY_MIN} minutes' AS at) x`);

    for (const r of (await db.query<{ uid: string; last_target: string }>(`SELECT uid, last_target FROM vol_user WHERE until <= now()`)).rows) lastTarget.set(r.uid, r.last_target);
    for (const table of BIG) await db.query(`ANALYZE ${table}`);
  } finally {
    db.release();
  }
}

const count = async (sql: string, values: unknown[] = []) => (await t.c.db.query<{ n: number }>(sql, values)).rows[0]!.n;

describe("decisiones del 2026-10-11 con volumen", () => {
  it("el volumen quedó cargado", async () => {
    expect(await count(`SELECT count(*)::int AS n FROM identity.users`)).toBeGreaterThan(USERS);
    expect(await count(`SELECT count(*)::int AS n FROM social.comments`)).toBeGreaterThan(COMMENTS);
    expect(await count(`SELECT count(*)::int AS n FROM alert.notifications`)).toBeGreaterThan(3 * ALERTS);
    expect(await count(`SELECT count(*)::int AS n FROM moderation.actions`)).toBeGreaterThan(USERS);
    expect(await count(`SELECT count(*)::int AS n FROM report.reports WHERE author_user_id = $1`, [reportera.userId])).toBeGreaterThan(3000);
    expect(await count(`SELECT count(*)::int AS n FROM ingestion.runs`)).toBeGreaterThan(100_000);
  });

  it("comentar y responder: contexto, tope diario y envío sin recorrer tablas grandes", async () => {
    const before = { autora: await count(`SELECT count(*)::int AS n FROM alert.notifications WHERE profile_id = $1`, [autora.profileId]),
      otra: await count(`SELECT count(*)::int AS n FROM alert.notifications WHERE profile_id = $1 AND match = 'REPLIED'`, [otra.profileId]) };
    const r = await scansDuring(t, async () => {
      await comment(vecino, postId, "Ya volvió en mi calle", otraCommentId);
      await t.c.dispatcher.drain();
      await t.c.alerts.flush();
    }, BIG);
    expect(r.queries).toBeGreaterThan(5);
    expect(r.scans).toEqual([]);
    // La autora ya tenía su tope del día: no recibe aviso. `otra` (dos hoy) recibe la respuesta.
    expect(await count(`SELECT count(*)::int AS n FROM alert.notifications WHERE profile_id = $1`, [autora.profileId])).toBe(before.autora);
    expect(await count(`SELECT count(*)::int AS n FROM alert.notifications WHERE profile_id = $1 AND match = 'REPLIED'`, [otra.profileId])).toBe(before.otra + 1);
  });

  it("envío con avisos sociales pendientes: sin recorrer tablas grandes", async () => {
    expect(await count(`SELECT count(*)::int AS n FROM alert.notifications WHERE status = 'PENDING'`)).toBe(0);
    await t.c.db.query(`UPDATE alert.notifications SET status = 'PENDING', next_attempt_at = NULL
      WHERE id IN (SELECT id FROM alert.notifications WHERE match IN ('COMMENTED','REPLIED') AND status = 'SENT' ORDER BY created_at DESC LIMIT 40)`);
    const r = await scansDuring(t, () => t.c.alerts.flush(), BIG);
    expect(r.scans).toEqual([]);
    expect(await count(`SELECT count(*)::int AS n FROM alert.notifications WHERE status = 'PENDING'`)).toBe(0);
  });

  it("perfil público con miles de reportes: sin recorrer tablas grandes y el recuento es el de referencia", async () => {
    // Referencia escrita aparte, como la define ADR 0321: eventos distintos, corroborados y publicados, con evidencia activa.
    const { rows: [ref] } = await t.c.db.query<{ total: number; official: number }>(
      `SELECT count(DISTINCT e.id)::int AS total, count(DISTINCT e.id) FILTER (WHERE e.verification_level = 'OFFICIALLY_CONFIRMED')::int AS official
         FROM report.reports r
         JOIN event.evidence v ON v.evidence_type = 'CITIZEN_REPORT' AND v.ref_id = r.id AND v.status = 'ACTIVE'
         JOIN event.events e ON e.id = v.event_id
        WHERE r.author_user_id = $1 AND r.status = 'ACCEPTED' AND r.assertion = 'OCCURRING' AND r.anonymity_mode = 'PUBLIC'
          AND r.presence_band IN ('HIGH','MEDIUM') AND r.event_id IS NOT NULL
          AND e.verification_level IN ('COMMUNITY_CORROBORATED','EXTERNALLY_CORROBORATED','OFFICIALLY_CONFIRMED')
          AND e.negative_state = 'NONE' AND e.publication_state = 'PUBLISHED' AND e.merged_into_id IS NULL`, [reportera.userId]);
    expect(ref!.total).toBeGreaterThan(100);
    expect(ref!.official).toBeGreaterThan(0);
    const url = `/v1/profiles/${await handleOf(reportera)}`;
    for (const viewer of [undefined, vecino, reportera]) {
      const r = await scansOf(t, url, BIG, viewer);
      expect(r.status).toBe(200);
      expect(r.scans).toEqual([]);
    }
    const view = (await t.app.inject({ url })).json() as ProfileView;
    expect(view.corroboratedReports).toEqual(ref);
    const me = await scansOf(t, "/v1/me", BIG, reportera);
    expect(me.status).toBe(200);
    expect(me.scans).toEqual([]);
  });

  it("fin de suspensiones: sin recorrer tablas grandes, sin una consulta por cuenta y con la última suspensión", async () => {
    const expected = await count(`SELECT count(*)::int AS n FROM identity.users WHERE status = 'SUSPENDED' AND suspended_until <= now()`);
    expect(expected).toBe(USERS / 80);
    const job = hourlyJobs(t.c).find(([n]) => n === "moderation.suspensions.expire")!;
    let out: unknown;
    const r = await scansDuring(t, async () => { out = await job[1](); }, BIG);
    expect(out).toEqual({ count: expected });
    expect(r.scans).toEqual([]);
    // Antes: una lectura del registro por cada cuenta reactivada (N+1). Ahora: una para todas.
    expect(r.queries).toBeLessThanOrEqual(3);
    // Cada reactivación queda sobre el objeto de la última suspensión de esa cuenta, como acción automática.
    const { rows } = await t.c.db.query<{ affected_user_id: string; target_id: string; actor: string; moderator_user_id: string | null }>(
      `SELECT affected_user_id, target_id, actor, moderator_user_id FROM moderation.actions WHERE action = 'UNSUSPEND_USER' AND affected_user_id = ANY($1)`,
      [[...lastTarget.keys()]]);
    expect(rows).toHaveLength(expected);
    for (const a of rows) expect(a).toMatchObject({ target_id: lastTarget.get(a.affected_user_id), actor: "RULE", moderator_user_id: null });
    expect(await count(`SELECT count(*)::int AS n FROM identity.users WHERE status = 'SUSPENDED' AND suspended_until <= now()`)).toBe(0);
  });

  it("fuentes de administración con meses de corridas: lee solo el último día de cada fuente", async () => {
    const r = await scansOf(t, "/v1/admin/sources", BIG, admin);
    expect(r.status).toBe(200);
    expect(r.scans).toEqual([]);
    const sources = await count(`SELECT count(*)::int AS n FROM ingestion.sources`);
    const runs = await rowsReadDuring(t, () => t.app.inject({ url: "/v1/admin/sources", headers: auth(admin) }), new Set(["ingestion.runs"]));
    // Un día de corridas por fuente (144) y unas pocas filas para la última corrida, la última correcta y el último error.
    const perDay = (24 * 60) / RUN_EVERY_MIN;
    expect(runs.get("ingestion.runs") ?? 0).toBeLessThanOrEqual(sources * (perDay + 10));
  });

  it("fuentes de administración: las mismas cifras que agregando toda la historia", async () => {
    // Con fallos seguidos se muestra el último error; la fuente que nunca falló no tiene ninguno.
    await t.c.db.query(`INSERT INTO ingestion.source_state (source_id, consecutive_failures) SELECT id, 1 FROM ingestion.sources
      ON CONFLICT (source_id) DO UPDATE SET consecutive_failures = 1`);
    // Una corrida fallida reciente, para que el último error no sea siempre el mismo texto.
    await t.c.db.query(`INSERT INTO ingestion.runs (id, source_id, lane, started_at, status, error)
      SELECT gen_random_uuid(), id, 'NORMAL', now() - interval '3 minutes', 'FAILED', 'HTTP 500 reciente' FROM ingestion.sources WHERE key = (SELECT min(key) FROM ingestion.sources)`);
    const now = t.c.clock.now();
    // Referencia: la consulta anterior a ADR 0322, que agrega todas las corridas de cada fuente.
    const { rows } = await t.c.db.query<{ key: string; last_run_at: Date | null; last_ok_at: Date | null; runs_ok: number; runs_failed: number; items_new: number; last_error: string | null }>(
      `SELECT s.key, r.last_run_at, r.last_ok_at, r.runs_ok, r.runs_failed, r.items_new,
              (SELECT error FROM ingestion.runs x WHERE x.source_id = s.id AND x.status = 'FAILED' ORDER BY started_at DESC LIMIT 1) AS last_error
         FROM ingestion.sources s
         LEFT JOIN LATERAL (
           SELECT max(started_at) AS last_run_at,
                  max(started_at) FILTER (WHERE status IN ('OK','NOT_MODIFIED')) AS last_ok_at,
                  count(*) FILTER (WHERE status IN ('OK','NOT_MODIFIED') AND started_at > $1::timestamptz - interval '24 hours')::int AS runs_ok,
                  count(*) FILTER (WHERE status = 'FAILED' AND started_at > $1::timestamptz - interval '24 hours')::int AS runs_failed,
                  coalesce(sum(items_new) FILTER (WHERE started_at > $1::timestamptz - interval '24 hours'), 0)::int AS items_new
             FROM ingestion.runs WHERE source_id = s.id) r ON true`, [now]);
    const got = new Map((await t.c.ingestion.adminSources(now)).map((s) => [s.key, s]));
    expect(got.size).toBe(rows.length);
    expect(rows.filter((r) => r.last_error !== null).length).toBeGreaterThan(1);
    expect(rows.filter((r) => r.last_error === null).length).toBe(1);
    for (const r of rows) {
      expect(got.get(r.key), r.key).toMatchObject({
        lastRunAt: r.last_run_at?.toISOString() ?? null, lastOkAt: r.last_ok_at?.toISOString() ?? null,
        runsOk: r.runs_ok, runsFailed: r.runs_failed, itemsNew: r.items_new, lastError: r.last_error,
      });
    }
  });

  it("retención de corridas de fuentes: sin recorrer la tabla", async () => {
    const job = dailyJobs(t.c).find(([n]) => n === "retention.source-raw")!;
    const old = await count(`SELECT count(*)::int AS n FROM ingestion.runs WHERE raw_ref IS NULL AND started_at < now() - interval '90 days'`);
    expect(old).toBeGreaterThan(0);
    const r = await scansDuring(t, job[1], BIG);
    expect(r.scans).toEqual([]);
    expect(await count(`SELECT count(*)::int AS n FROM ingestion.runs WHERE raw_ref IS NULL AND started_at < now() - interval '90 days'`)).toBe(0);
  });
});
