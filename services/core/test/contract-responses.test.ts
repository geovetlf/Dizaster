import * as C from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { deepStrict, expectContract } from "./contract-strict.js";
import { LIMA, createTestContext, createUser, offset, reportBody, seedGeoFixtures, submit, type TestContext, type TestUser } from "./helpers.js";

/**
 * Contratos de respuesta (ADR 0342): cada ruta principal responde exactamente lo que `@dizaster/contracts` declara,
 * validado con el esquema zod en modo estricto (sin campos de más ni de menos). Recorre rutas públicas y con sesión
 * sobre datos reales creados por la propia API.
 */
let t: TestContext;
let ana: TestUser;
let beto: TestUser;
let eventId: string;
let anaHandle: string;
let betoHandle: string;
const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });

async function get(url: string, u?: TestUser): Promise<unknown> {
  const res = await t.app.inject({ url, ...(u ? { headers: auth(u) } : {}) });
  expect(res.statusCode, `${url}: ${res.body}`).toBe(200);
  return res.json();
}

/** Tesela slippy z/x/y que contiene un punto. */
function tileOf(p: { lat: number; lng: number }, zoom: number) {
  const n = 2 ** zoom;
  const x = Math.floor(((p.lng + 180) / 360) * n);
  const r = (p.lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return { z: zoom, x, y };
}

beforeAll(async () => {
  t = await createTestContext();
  await seedGeoFixtures(t);
  ana = await createUser(t, "contrato_ana");
  beto = await createUser(t, "contrato_beto");
  const r1 = await submit(t, ana, reportBody(ana, { text: "Choque en la avenida" }));
  expect(r1.status).toBe(200);
  eventId = r1.body.eventId!;
  const r2 = await submit(t, beto, reportBody(beto, { pin: offset(LIMA, 40) }));
  expect(r2.body.eventId).toBe(eventId);
  await t.c.dispatcher.drain();
  anaHandle = ((await get("/v1/me", ana)) as C.MyProfile).handle;
  betoHandle = ((await get("/v1/me", beto)) as C.MyProfile).handle;
});
afterAll(async () => { await t.close(); });

describe("validación estricta", () => {
  it("rechaza campos no declarados también en objetos anidados, uniones y recursión", () => {
    const post = {
      id: "p", kind: "SHARE", author: { pseudonymous: true }, text: null, lang: null, createdAt: "2026-01-01T00:00:00Z", categoryCode: null,
      event: null, place: null, distanceBucket: null, media: [], hiddenMediaCount: 0, likeCount: 0, commentCount: 0, likedByMe: false,
      reactions: { LIKE: 1 }, myReactions: [], mentions: [], businessMentions: [], shareCount: 0, externalShareCount: 0, mine: false, share: null,
    };
    const ok = { ...post, share: { post: { ...post, kind: "STANDARD" } } };
    expect(deepStrict(C.FeedPostSchema).safeParse(ok).success).toBe(true);
    expect(deepStrict(C.FeedPostSchema).safeParse({ ...post, userId: "x" }).success).toBe(false);
    expect(deepStrict(C.FeedPostSchema).safeParse({ ...post, author: { pseudonymous: true, handle: "x" } }).success).toBe(false);
    expect(deepStrict(C.FeedPostSchema).safeParse({ ...ok, share: { post: { ...post, reporterPoint: { lat: 1, lng: 2 } } } }).success).toBe(false);
    expect(deepStrict(C.FeedPostSchema).safeParse({ ...post, reactions: { NOPE: 1 } }).success).toBe(false);
    const { mentions: _m, ...missing } = post;
    expect(deepStrict(C.FeedPostSchema).safeParse(missing).success).toBe(false);
  });
});

describe("contratos de respuesta con esquema zod", () => {
  it("configuración, catálogo, números de emergencia y atribuciones", async () => {
    expectContract(C.AppConfig, await get("/v1/config"), "GET /v1/config");
    expectContract(C.CategoryCatalog, await get("/v1/reference/categories"), "GET /v1/reference/categories");
    const full = (await get("/v1/reference/emergency-numbers")) as { version: string };
    expectContract(C.EmergencyNumbersResponse, full, "GET /v1/reference/emergency-numbers");
    expectContract(C.EmergencyNumbersResponse, await get(`/v1/reference/emergency-numbers?since=${full.version}`), "emergency-numbers?since");
    expectContract(C.EmergencyNumbersResponse, await get("/v1/reference/emergency-numbers?country=PE"), "emergency-numbers?country");
    expectContract(C.AttributionsResponse, await get("/v1/about/attributions"), "GET /v1/about/attributions");
  });

  it("envío de reportes: cada desenlace cumple SubmitReportResponse", async () => {
    const u = await createUser(t, "contrato_reporta");
    const created = await submit(t, u, reportBody(u, { pin: offset(LIMA, 6000) }));
    expect(created.body.outcome).toBe("CREATED_EVENT");
    expectContract(C.SubmitReportResponse, created.body, "POST /v1/reports (CREATED_EVENT)");
    const v = await createUser(t, "contrato_adjunta");
    const attached = await submit(t, v, reportBody(v, { pin: offset(LIMA, 6030) }));
    expect(attached.body.outcome).toBe("ATTACHED_TO_EVENT");
    expectContract(C.SubmitReportResponse, attached.body, "POST /v1/reports (ATTACHED_TO_EVENT)");
    const down = await submit(t, u, reportBody(u, { pin: offset(LIMA, 3000), fix: offset(LIMA, 6000) }));
    expect(down.body.outcome).toBe("DOWNGRADED_TO_POST");
    expectContract(C.SubmitReportResponse, down.body, "POST /v1/reports (DOWNGRADED_TO_POST)");
    const retryBody = reportBody(v, { pin: offset(LIMA, 6060) });
    const first = await submit(t, v, retryBody);
    const again = await submit(t, v, retryBody);
    expect(again.body).toEqual(first.body);
    expectContract(C.SubmitReportResponse, again.body, "POST /v1/reports (reintento)");
    const rejected = await submit(t, u, reportBody(u, { category: "no.existe", pin: offset(LIMA, 6000) }));
    expect(rejected.body.outcome).toBe("REJECTED");
    expectContract(C.SubmitReportResponse, rejected.body, "POST /v1/reports (REJECTED)");
  });

  it("mapa por bbox (puntos y grupos), teselas, cercanos y búsqueda", async () => {
    const bbox = `${LIMA.lng - 0.05},${LIMA.lat - 0.05},${LIMA.lng + 0.05},${LIMA.lat + 0.05}`;
    const points = (await get(`/v1/events?bbox=${bbox}&zoom=15`)) as C.EventMapResponse;
    expect(points.events.map((e) => e.id)).toContain(eventId);
    expectContract(C.EventMapResponse, points, "GET /v1/events (puntos)");
    const wide = `${LIMA.lng - 3},${LIMA.lat - 3},${LIMA.lng + 3},${LIMA.lat + 3}`;
    const clusters = (await get(`/v1/events?bbox=${wide}&zoom=5`)) as C.EventMapResponse;
    expectContract(C.EventMapResponse, clusters, `GET /v1/events (${clusters.mode})`);
    const tile = tileOf(LIMA, 14);
    expectContract(C.EventMapResponse, await get(`/v1/events/tiles/${tile.z}/${tile.x}/${tile.y}?window=24h`), "GET /v1/events/tiles");
    const nearby = (await get(`/v1/events/nearby?lat=${LIMA.lat}&lng=${LIMA.lng}&category=accident.traffic`, ana)) as C.NearbyEventsResponse;
    expect(nearby.events.length).toBeGreaterThan(0);
    expectContract(C.NearbyEventsResponse, nearby, "GET /v1/events/nearby");
    const found = (await get(`/v1/search/events?q=${encodeURIComponent("choque")}`)) as C.EventSearchResponse;
    expectContract(C.EventSearchResponse, found, "GET /v1/search/events");
  });

  it("ficha del evento, verificación, línea de tiempo y donaciones", async () => {
    expectContract(C.EventDetail, await get(`/v1/events/${eventId}`), "GET /v1/events/:id");
    expectContract(C.VerificationView, await get(`/v1/events/${eventId}/verification`), "GET /v1/events/:id/verification");
    const page = await get(`/v1/events/${eventId}/timeline`);
    expectContract(z.object({ entries: z.array(C.TimelineEntryView), nextCursor: z.uuid().nullable() }), page, "GET /v1/events/:id/timeline");
    expectContract(C.EventDonationsResponse, await get(`/v1/events/${eventId}/donations`), "GET /v1/events/:id/donations");
  });

  it("preferencias de avisos (lectura y cambio)", async () => {
    expectContract(C.AlertPreferences, await get("/v1/me/alert-preferences", ana), "GET /v1/me/alert-preferences");
    const res = await t.app.inject({ method: "PUT", url: "/v1/me/alert-preferences", headers: auth(ana), payload: { minSeverity: 3 } });
    expect(res.statusCode, res.body).toBe(200);
    expectContract(C.AlertPreferences, res.json(), "PUT /v1/me/alert-preferences");
  });
});

describe("contratos de respuesta publicados como interfaces (esquemas espejo, ADR 0342)", () => {
  async function send(method: "POST" | "PUT" | "PATCH" | "DELETE", url: string, u: TestUser, payload?: object) {
    const res = await t.app.inject({ method, url, headers: auth(u), ...(payload ? { payload } : {}) });
    expect(res.statusCode, `${method} ${url}: ${res.body}`).toBeLessThan(300);
    return res.statusCode === 204 ? null : res.json();
  }

  it("publicaciones, compartidos, seudónimos, reacciones y comentarios", async () => {
    const created = (await send("POST", "/v1/posts", ana, { text: `Corte de luz en #Miraflores, @${betoHandle} avisa`, eventId })) as { postId: string };
    const pseudo = (await send("POST", "/v1/posts", ana, { text: "Lo vi desde la ventana", anonymityMode: "PSEUDONYMOUS" })) as { postId: string };
    const shared = (await send("POST", `/v1/posts/${created.postId}/share`, beto, { text: "Ojo con esto" })) as { postId: string };
    await send("POST", "/v1/posts", ana, { text: "Se borrará" });
    expectContract(C.ReactionStateSchema, await send("PUT", `/v1/posts/${created.postId}/reactions/SEEN_TOO`, beto), "PUT /v1/posts/:id/reactions/:kind");
    await send("PUT", `/v1/posts/${created.postId}/like`, beto);
    const comment = await send("POST", `/v1/posts/${created.postId}/comments`, beto, { text: "Gracias por avisar" });
    expectContract(C.CommentViewSchema, comment, "POST /v1/posts/:id/comments");
    await send("POST", `/v1/posts/${created.postId}/comments`, ana, { text: "De nada", parentId: (comment as { id: string }).id });
    expectContract(C.ReactionStateSchema, await send("PUT", `/v1/comments/${(comment as { id: string }).id}/reactions/USEFUL`, ana), "PUT /v1/comments/:id/reactions/:kind");

    for (const u of [undefined, ana, beto]) {
      const who = u ? `con sesión de ${u === ana ? "autora" : "lectora"}` : "sin sesión";
      const feed = (await get("/v1/feed?limit=30", u)) as C.FeedResponse;
      expect(feed.posts.length).toBeGreaterThan(2);
      expectContract(C.FeedResponseSchema, feed, `GET /v1/feed (${who})`);
      expectContract(C.FeedPostSchema, await get(`/v1/posts/${created.postId}`, u), `GET /v1/posts/:id (${who})`);
      expectContract(C.FeedPostSchema, await get(`/v1/posts/${shared.postId}`, u), `GET /v1/posts/:id SHARE (${who})`);
      expectContract(C.FeedPostSchema, await get(`/v1/posts/${pseudo.postId}`, u), `GET /v1/posts/:id seudónimo (${who})`);
      expectContract(C.CommentsPageSchema, await get(`/v1/posts/${created.postId}/comments`, u), `GET /v1/posts/:id/comments (${who})`);
      expectContract(C.FeedResponseSchema, await get(`/v1/events/${eventId}/posts`, u), `GET /v1/events/:id/posts (${who})`);
      expectContract(C.FeedResponseSchema, await get(`/v1/profiles/${anaHandle}/posts`, u), `GET /v1/profiles/:handle/posts (${who})`);
      expectContract(C.FeedResponseSchema, await get("/v1/tags/miraflores/posts", u), `GET /v1/tags/:tag/posts (${who})`);
      expectContract(C.FeedResponseSchema, await get(`/v1/search/posts?q=${encodeURIComponent("corte de luz")}`, u), `GET /v1/search/posts (${who})`);
      expectContract(C.FeedResponseSchema, await get(`/v1/feed?tab=nearby&lat=${LIMA.lat}&lng=${LIMA.lng}`, u), `GET /v1/feed?tab=nearby (${who})`);
      expectContract(C.TagViewSchema, await get("/v1/tags/miraflores", u), `GET /v1/tags/:tag (${who})`);
      expectContract(C.ProfileViewSchema, await get(`/v1/profiles/${anaHandle}`, u), `GET /v1/profiles/:handle (${who})`);
      expectContract(z.object({ profiles: z.array(C.ProfileSearchResultSchema) }), await get("/v1/profiles?q=contrato", u), `GET /v1/profiles (${who})`);
    }
    const sharedView = (await get(`/v1/posts/${shared.postId}`, beto)) as C.FeedPost;
    expect(sharedView.share?.post?.id).toBe(created.postId);
  });

  it("mi perfil, seguimientos, mis reportes, avisos, zonas, suscripciones, sesiones y políticas", async () => {
    expectContract(C.MyProfileSchema, await get("/v1/me", ana), "GET /v1/me");
    expectContract(C.MyProfileSchema, await send("PATCH", "/v1/me", ana, { bio: "Vecina de Lima", showCorroboratedReports: true }), "PATCH /v1/me");
    await send("PUT", `/v1/follows/profile/${anaHandle}`, beto);
    await send("PUT", `/v1/follows/event/${eventId}`, beto);
    await send("PUT", "/v1/follows/tag/miraflores", beto);
    expectContract(C.MyFollowsSchema, await get("/v1/me/follows", beto), "GET /v1/me/follows");
    const mine = (await get("/v1/me/reports", ana)) as C.MyReportsResponse;
    expect(mine.reports.length).toBeGreaterThan(0);
    expectContract(C.MyReportsResponseSchema, mine, "GET /v1/me/reports");
    expectContract(C.NotificationsResponseSchema, await get("/v1/me/notifications", ana), "GET /v1/me/notifications");
    const zone = await send("POST", "/v1/me/zones", ana, { kind: "HOME", name: "Casa", lat: LIMA.lat, lng: LIMA.lng });
    expectContract(C.SavedZoneSchema, zone, "POST /v1/me/zones");
    expectContract(z.object({ zones: z.array(C.SavedZoneSchema) }), await get("/v1/me/zones", ana), "GET /v1/me/zones");
    const sub = await send("POST", "/v1/me/alert-subscriptions", ana, { categoryCode: "accident.traffic", areaId: "PE" });
    expectContract(C.CategorySubscriptionSchema, sub, "POST /v1/me/alert-subscriptions");
    expectContract(z.object({ subscriptions: z.array(C.CategorySubscriptionSchema) }), await get("/v1/me/alert-subscriptions", ana), "GET /v1/me/alert-subscriptions");
    expectContract(z.object({ sessions: z.array(C.SessionViewSchema) }), await get("/v1/me/sessions", ana), "GET /v1/me/sessions");
    expectContract(C.PolicyStatusResponseSchema, await get("/v1/me/policies", ana), "GET /v1/me/policies");
    // La mención a beto de la prueba anterior deja un aviso real en su bandeja.
    await t.c.dispatcher.drain();
    const inbox = (await get("/v1/me/notifications", beto)) as C.NotificationsResponse;
    expect(inbox.notifications.length).toBeGreaterThan(0);
    expectContract(C.NotificationsResponseSchema, inbox, "GET /v1/me/notifications (con avisos)");
  });
});

describe("OpenAPI publica los mismos esquemas de respuesta", () => {
  it("la ficha del evento, el feed y los posts recursivos se documentan con su contrato", async () => {
    type Op = { responses: Record<string, { content?: Record<string, { schema: Record<string, unknown> }> }> };
    const doc = (await get("/v1/openapi.json")) as { paths: Record<string, Record<string, Op>> };
    const schemaOf = (p: string, m: string) => doc.paths[p]![m]!.responses["2XX"]!.content?.["application/json"]?.schema;
    const detail = schemaOf("/v1/events/{id}", "get") as { properties: Record<string, unknown> };
    expect(Object.keys(detail.properties)).toEqual(expect.arrayContaining(["mergedIntoId", "publicationState", "affectedArea"]));
    // Un post SHARE anida el original: el JSON Schema lo resuelve con una referencia, sin expandirse sin fin.
    const post = JSON.stringify(schemaOf("/v1/posts/{id}", "get"));
    expect(post).toContain('"share"');
    expect(post.length).toBeLessThan(50_000);
    for (const [p, m] of [["/v1/feed", "get"], ["/v1/me", "get"], ["/v1/me/reports", "get"], ["/v1/me/notifications", "get"], ["/v1/posts/{id}/comments", "get"]] as const) {
      expect(schemaOf(p, m), `${m} ${p}`).toMatchObject({ type: "object" });
    }
  });
});
