import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FeedFilter } from "../src/modules/social/index.js";
import { MAX_RANK_BOOST_HOURS } from "../src/modules/social/index.js";
import { createTestContext, createUser, LIMA, offset, reportBody, submit, type TestContext, type TestUser } from "./helpers.js";

/**
 * Planes de consulta con volumen (ADR 0309). Con tablas casi vacías PostgreSQL siempre recorre la tabla entera, así
 * que un índice que falta no se nota hasta producción. Aquí se clonan miles de eventos, posts, comentarios y entradas
 * de timeline sobre filas reales creadas por la API, se ejecuta cada lectura pública caliente y se pide el plan de
 * cada SELECT que lanzó: ninguno puede recorrer entera una tabla grande. NO AI REQUIRED.
 */
const EVENTS = 20_000;
const POSTS = 40_000;
const COMMENTS = 40_000;
const BIG = new Set(["events", "posts", "comments", "timeline", "evidence", "post_event_links", "event_signals"]);

let t: TestContext;
let users: TestUser[];
let eventId: string;
let postId: string;
let handle: string;

beforeAll(async () => {
  t = await createTestContext();
  users = [];
  for (let i = 0; i < 8; i++) users.push(await createUser(t, `vol_${i}`));
  const r = await submit(t, users[0]!, reportBody(users[0]!, { category: "fire.structure", pin: offset(LIMA, 3000), text: "Humo en el mercado #Ayuda" }));
  await t.c.dispatcher.drain();
  eventId = r.body.eventId!;
  postId = (await t.c.db.query<{ post_id: string }>(`SELECT post_id FROM social.post_event_links WHERE event_id = $1`, [eventId])).rows[0]!.post_id;
  handle = (await t.c.db.query<{ handle: string }>(`SELECT handle FROM social.profiles WHERE id = $1`, [users[0]!.profileId])).rows[0]!.handle;
  await seedVolume(users.map((u) => u.profileId));
}, 180_000);
afterAll(async () => { await t.close(); });

/**
 * Clona filas plantilla con jsonb_populate_record: copia todas las columnas, incluso las que agreguen migraciones
 * futuras. Las columnas generadas se calculan solas y no se insertan.
 */
async function clone(db: pg.PoolClient, table: string, overrides: string, from: string, values: unknown[]): Promise<void> {
  const [schema, name] = table.split(".");
  const { rows } = await db.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND is_generated = 'NEVER' ORDER BY ordinal_position`,
    [schema, name]);
  const cols = rows.map((r) => `"${r.column_name}"`).join(", ");
  await db.query(`INSERT INTO ${table} (${cols})
    SELECT ${rows.map((r) => `x."${r.column_name}"`).join(", ")}
    FROM ${from}, LATERAL jsonb_populate_record(NULL::${table}, to_jsonb(s) || jsonb_build_object(${overrides})) x`, values);
}

async function seedVolume(profiles: string[]): Promise<void> {
  const db = await t.c.db.connect();
  try {
    await db.query(`SELECT setseed(0.42)`);
    await db.query(`CREATE TEMP TABLE vol_ev AS
      SELECT g AS n, gen_random_uuid() AS id, -18 + random() * 17.5 AS lat, -81 + random() * 12 AS lng,
             now() - random() * interval '30 days' AS at
      FROM generate_series(1, ${EVENTS}) g`);
    const cats = ["fire.structure", "accident.traffic", "crime.robbery", "natural.earthquake", "flood.urban"];
    await clone(db, "event.events", `
        'id', v.id,
        'geom', ST_AsEWKT(ST_SetSRID(ST_MakePoint(v.lng, v.lat), 4326)),
        'public_geom', ST_AsEWKT(ST_SetSRID(ST_MakePoint(v.lng, v.lat), 4326)),
        'public_h3', h3_lat_lng_to_cell(point(v.lng, v.lat), 8)::text,
        'h3_r7', h3_lat_lng_to_cell(point(v.lng, v.lat), 7)::text,
        'h3_r9', h3_lat_lng_to_cell(point(v.lng, v.lat), 9)::text,
        'category_code', ($2::text[])[1 + v.n % 5],
        'status', CASE WHEN v.n % 4 = 0 THEN 'RESOLVED' ELSE 'ACTIVE' END,
        'publication_state', 'PUBLISHED',
        'occurred_start', v.at, 'first_seen_at', v.at, 'last_activity_at', v.at, 'created_at', v.at, 'updated_at', v.at`,
      `vol_ev v CROSS JOIN (SELECT * FROM event.events WHERE id = $1) s`, [eventId, cats]);
    await clone(db, "event.timeline", `'id', gen_random_uuid(), 'event_id', v.id, 'at', v.at`,
      `vol_ev v CROSS JOIN (SELECT * FROM event.timeline WHERE event_id = $1) s`, [eventId]);
    await clone(db, "event.evidence", `
        'id', gen_random_uuid(), 'event_id', v.id, 'ref_id', gen_random_uuid(), 'observed_at', v.at, 'added_at', v.at,
        'point', ST_AsEWKT(ST_SetSRID(ST_MakePoint(v.lng, v.lat), 4326))`,
      `vol_ev v CROSS JOIN (SELECT * FROM event.evidence WHERE event_id = $1) s`, [eventId]);
    await clone(db, "social.event_signals", `'event_id', v.id, 'public_point', ST_AsEWKT(ST_SetSRID(ST_MakePoint(v.lng, v.lat), 4326))`,
      `vol_ev v CROSS JOIN (SELECT * FROM social.event_signals WHERE event_id = $1) s`, [eventId]);

    await db.query(`CREATE TEMP TABLE vol_post AS
      SELECT g AS n, gen_random_uuid() AS id, -18 + random() * 17.5 AS lat, -81 + random() * 12 AS lng,
             now() - random() * interval '30 days' AS at
      FROM generate_series(1, ${POSTS}) g`);
    await clone(db, "social.posts", `
        'id', v.id, 'author_id', ($2::uuid[])[1 + v.n % cardinality($2::uuid[])], 'client_id', NULL, 'text_hash', NULL,
        'text', 'Publicación de volumen ' || v.n, 'kind', CASE WHEN v.n % 3 = 0 THEN 'REPORT' ELSE 'STANDARD' END,
        'public_point', ST_AsEWKT(ST_SetSRID(ST_MakePoint(v.lng, v.lat), 4326)),
        'created_at', v.at, 'updated_at', v.at`,
      `vol_post v CROSS JOIN (SELECT * FROM social.posts WHERE id = $1) s`, [postId, profiles]);
    // Un tercio de los posts nombra un evento, como los posts de reporte.
    await db.query(`INSERT INTO social.post_event_links (post_id, event_id, link_type, created_at)
      SELECT p.id, e.id, 'REPORT', p.at FROM vol_post p JOIN vol_ev e ON e.n = 1 + p.n % ${EVENTS} WHERE p.n % 3 = 0`);
    // Comentarios repartidos en 2000 posts, más un hilo largo en el post de prueba.
    await db.query(`INSERT INTO social.comments (id, post_id, author_profile_id, text, created_at)
      SELECT gen_random_uuid(), CASE WHEN g % 10 = 0 THEN $1::uuid ELSE p.id END, ($2::uuid[])[1 + g % cardinality($2::uuid[])],
             'Comentario ' || g, now() - random() * interval '30 days'
      FROM generate_series(1, ${COMMENTS}) g JOIN vol_post p ON p.n = 1 + g % 2000`, [postId, profiles]);
    for (const table of ["event.events", "event.timeline", "event.evidence", "social.event_signals", "social.posts", "social.post_event_links", "social.comments"]) {
      await db.query(`ANALYZE ${table}`);
    }
  } finally {
    db.release();
  }
}

interface PlanNode { "Node Type": string; "Relation Name"?: string; Plans?: PlanNode[] }
function seqScans(node: PlanNode, out: string[] = []): string[] {
  if (node["Node Type"] === "Seq Scan" && node["Relation Name"] && BIG.has(node["Relation Name"])) out.push(node["Relation Name"]);
  for (const child of node.Plans ?? []) seqScans(child, out);
  return out;
}

/** Ejecuta la petición, guarda cada SELECT que lanzó y devuelve las tablas grandes recorridas enteras. */
async function scansOf(url: string, user?: TestUser): Promise<{ status: number; queries: number; scans: string[] }> {
  const seen: { text: string; values: unknown[] }[] = [];
  const proto = pg.Client.prototype as unknown as { query: (...a: unknown[]) => unknown };
  const original = proto.query;
  proto.query = function (this: unknown, ...a: unknown[]) {
    const [text, values] = a;
    if (typeof text === "string" && /^\s*(SELECT|WITH)\b/i.test(text)) seen.push({ text, values: Array.isArray(values) ? values : [] });
    return original.apply(this, a);
  };
  let status: number;
  try {
    status = (await t.app.inject({ url, ...(user ? { headers: { authorization: `Bearer ${user.token}` } } : {}) })).statusCode;
  } finally {
    proto.query = original;
  }
  const scans: string[] = [];
  for (const q of seen) {
    const { rows } = await t.c.db.query<{ "QUERY PLAN": { Plan: PlanNode }[] }>(`EXPLAIN (FORMAT JSON) ${q.text}`, q.values);
    for (const name of seqScans(rows[0]!["QUERY PLAN"][0]!.Plan)) scans.push(`${name} ← ${q.text.replace(/\s+/g, " ").trim().slice(0, 160)}`);
  }
  return { status, queries: seen.length, scans };
}

describe("lecturas públicas con volumen", () => {
  it("el volumen quedó cargado", async () => {
    const { rows } = await t.c.db.query<{ e: number; p: number; c: number }>(
      `SELECT (SELECT count(*) FROM social.event_signals)::int AS e, (SELECT count(*) FROM social.posts)::int AS p, (SELECT count(*) FROM social.comments)::int AS c`);
    expect(rows[0]!.e).toBeGreaterThan(EVENTS);
    expect(rows[0]!.p).toBeGreaterThan(POSTS);
    expect(rows[0]!.c).toBeGreaterThanOrEqual(COMMENTS);
  });

  const bbox = [LIMA.lng - 0.2, LIMA.lat - 0.2, LIMA.lng + 0.2, LIMA.lat + 0.2].join(",");
  const anon: [string, () => string][] = [
    ["mapa por bbox", () => `/v1/events?bbox=${bbox}&zoom=12`],
    ["mapa por bbox y categoría", () => `/v1/events?bbox=${bbox}&zoom=12&categories=fire.structure&window=24h`],
    ["tesela", () => `/v1/events/tiles/12/1171/2190`],
    ["ficha del evento", () => `/v1/events/${eventId}`],
    ["timeline", () => `/v1/events/${eventId}/timeline`],
    ["posts del evento", () => `/v1/events/${eventId}/posts`],
    ["verificación", () => `/v1/events/${eventId}/verification`],
    ["media del evento", () => `/v1/events/${eventId}/media`],
    ["fuentes del evento", () => `/v1/events/${eventId}/sources`],
    ["feed para ti", () => `/v1/feed?tab=for_you`],
    ["feed cerca", () => `/v1/feed?tab=nearby&lat=${LIMA.lat}&lng=${LIMA.lng}`],
    ["feed por categoría", () => `/v1/feed?tab=for_you&category=fire`],
    ["feed de videos", () => `/v1/feed?tab=videos`],
    ["perfil", () => `/v1/profiles/${handle}`],
    ["posts del perfil", () => `/v1/profiles/${handle}/posts`],
    ["post", () => `/v1/posts/${postId}`],
    ["comentarios", () => `/v1/posts/${postId}/comments`],
    ["posts de una etiqueta", () => `/v1/tags/ayuda/posts`],
  ];
  it.each(anon)("%s: sin recorrer tablas grandes", async (_name, url) => {
    const r = await scansOf(url());
    expect(r.status).toBe(200);
    expect(r.queries).toBeGreaterThan(0);
    expect(r.scans).toEqual([]);
  });

  it.each(anon.filter(([n]) => n.startsWith("feed") || n === "comentarios" || n === "posts del evento"))("%s con sesión: sin recorrer tablas grandes", async (_name, url) => {
    const r = await scansOf(url(), users[1]);
    expect(r.status).toBe(200);
    expect(r.scans).toEqual([]);
  });
});

describe("\"Para ti\" con corte por ventaja acotada", () => {
  // Posts con la mayor ventaja posible. Los de hace 8 h (confirmado oficial y gravedad 5) ganan a lo más nuevo en
  // cualquier caso; los de hace 15 h, solo si además están cerca y son de alguien seguido. El corte no puede dejar
  // fuera a ninguno de los dos grupos. Y lo de los últimos 15 min, en seguimiento, baja dos horas: la cota del
  // cursor no puede saltárselo en las páginas siguientes.
  beforeAll(async () => {
    await t.c.db.query(`
      UPDATE social.event_signals s SET public_state = 'OFFICIALLY_CONFIRMED', severity = 5, lifecycle = 'ACTIVE'
        FROM social.post_event_links l JOIN social.posts p ON p.id = l.post_id
       WHERE s.event_id = l.event_id
         AND (p.created_at BETWEEN now() - interval '8.5 hours' AND now() - interval '8 hours'
              OR p.created_at BETWEEN now() - interval '15.5 hours' AND now() - interval '15 hours')`);
    await t.c.db.query(`
      UPDATE social.event_signals s SET lifecycle = 'MONITORING'
        FROM social.post_event_links l JOIN social.posts p ON p.id = l.post_id
       WHERE s.event_id = l.event_id AND p.created_at > now() - interval '15 minutes'`);
    await t.c.db.query(`
      UPDATE social.posts p SET public_point = ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, author_id = $3
        FROM social.post_event_links l
       WHERE l.post_id = p.id AND p.created_at BETWEEN now() - interval '15.5 hours' AND now() - interval '15 hours'`,
      [LIMA.lng, LIMA.lat, users[0]!.profileId]);
    await t.c.db.query(`INSERT INTO social.follows (follower_profile_id, target_type, target_id)
      SELECT $1, 'PROFILE', $2 ON CONFLICT DO NOTHING`, [users[1]!.profileId, users[0]!.profileId]);
    await t.c.db.query(`ANALYZE social.event_signals`);
  });

  const page = (f: Partial<FeedFilter>) => t.c.social.feed(t.c.db, { tab: "for_you", limit: 50, viewerProfileId: null, ...f });

  it("la ventaja máxima suma 22 h con las reglas actuales", () => {
    expect(MAX_RANK_BOOST_HOURS).toBe(22);
  });

  const cases: [string, { viewer?: true; near?: { lat: number; lng: number }; category?: string }][] = [
    ["sin sesión", {}],
    ["con sesión", { viewer: true }],
    ["cerca y siguiendo al autor", { near: LIMA, viewer: true }],
    ["por categoría", { category: "fire" }],
  ];
  it.each(cases)("%s: cuatro páginas iguales a puntuar todo el mes", async (_name, { viewer, ...extra }) => {
    const f: Partial<FeedFilter> = { ...extra, ...(viewer ? { viewerProfileId: users[1]!.profileId } : {}) };
    let cursor: { score: number; id: string } | undefined;
    let boostedSeen = 0;
    let oldestSeenH = 0;
    let monitoringSeen = 0;
    for (let i = 0; i < 4; i++) {
      const fast = await page({ ...f, ...(cursor ? { cursor } : {}) });
      const slow = await page({ ...f, ...(cursor ? { cursor } : {}), exhaustive: true });
      expect(fast.map((r) => r.id)).toEqual(slow.map((r) => r.id));
      expect(fast).toHaveLength(50);
      const ages = fast.map((r) => (Date.now() - r.createdAt.getTime()) / 3_600_000);
      boostedSeen += ages.filter((h) => h > 7).length;
      oldestSeenH = Math.max(oldestSeenH, ...ages);
      if (i > 0) monitoringSeen += ages.filter((h) => h < 0.25).length;
      const last = fast.at(-1)!;
      cursor = { score: last.score, id: last.id };
    }
    expect(boostedSeen).toBeGreaterThan(0);
    if (extra.near) expect(oldestSeenH).toBeGreaterThan(14);
    expect(monitoringSeen).toBeGreaterThan(0);
  });
});
