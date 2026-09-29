import { createHash, randomUUID } from "node:crypto";
import { extractMentions, extractTags, normalizeTag, segmentText, textFingerprintBase, type FeedResponse, type MyFollows, type TagView } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, LIMA, reportBody, submit, type TestContext, type TestUser } from "./helpers.js";
import { makeJpeg } from "./media-fixtures.js";
import { withTransaction } from "../src/platform/db.js";
import { publish } from "../src/platform/outbox.js";

describe("etiquetas y menciones en el texto", () => {
  it("extrae etiquetas canónicas sin tildes y menciones en minúsculas", () => {
    expect(normalizeTag("Inundación")).toBe("inundacion");
    expect(extractTags("Ayuda #Inundación en #Lima y #inundacion otra vez, #2024 no, a#b no")).toEqual([
      { normalized: "inundacion", display: "Inundación" },
      { normalized: "lima", display: "Lima" },
    ]);
    expect(extractMentions("Hola @Ana_Q y @beto, correo x@mail.com no, @ana_q repetida")).toEqual(["ana_q", "beto"]);
    expect(extractTags(Array.from({ length: 15 }, (_, i) => `#t${i}x`).join(" "))).toHaveLength(10);
  });

  it("parte el texto en trozos pintables sin perder caracteres", () => {
    const text = "Cortes en #Miraflores, avisa @vecina.";
    const segs = segmentText(text);
    expect(segs).toEqual([
      { kind: "text", text: "Cortes en " },
      { kind: "tag", text: "#Miraflores", tag: "miraflores" },
      { kind: "text", text: ", avisa " },
      { kind: "mention", text: "@vecina", handle: "vecina" },
      { kind: "text", text: "." },
    ]);
    expect(segs.map((s) => s.text).join("")).toBe(text);
  });
});

describe("publicar sin reporte", () => {
  let t: TestContext;
  let ana: TestUser;
  let beto: TestUser;
  let carla: TestUser;
  let betoHandle: string;
  let carlaHandle: string;
  const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });
  const post = (u: TestUser, payload: object) => t.app.inject({ method: "POST", url: "/v1/posts", headers: auth(u), payload });
  const get = async <T>(url: string, u?: TestUser) => {
    const res = await t.app.inject({ url, ...(u ? { headers: auth(u) } : {}) });
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as T;
  };
  const handleOf = async (u: TestUser) => (await t.c.db.query<{ handle: string }>(`SELECT handle FROM social.profiles WHERE id = $1`, [u.profileId])).rows[0]!.handle;

  beforeAll(async () => {
    t = await createTestContext();
    ana = await createUser(t, "ana");
    beto = await createUser(t, "beto");
    carla = await createUser(t, "carla");
    betoHandle = await handleOf(beto);
    carlaHandle = await handleOf(carla);
  });
  afterAll(async () => t.close());

  it("crea un post con etiquetas y menciones válidas; bloqueos y perfiles inexistentes no se enlazan", async () => {
    expect((await t.app.inject({ method: "PUT", url: `/v1/blocks/${encodeURIComponent(await handleOf(ana))}`, headers: auth(carla) })).statusCode).toBe(200);
    const res = await post(ana, { text: `Donamos agua #Solidaridad #Lima con @${betoHandle.toUpperCase()}, @${carlaHandle} y @nadie_existe` });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ tags: ["solidaridad", "lima"], mentions: [betoHandle], eventId: null });

    const feed = await get<FeedResponse>("/v1/tags/solidaridad/posts", beto);
    expect(feed.posts).toHaveLength(1);
    expect(feed.posts[0]).toMatchObject({ kind: "STANDARD", mentions: [betoHandle], mine: false, place: null, distanceBucket: null });
    expect((await get<FeedResponse>("/v1/tags/Solidaridad/posts", ana)).posts[0]!.mine).toBe(true);
    expect(await get<TagView>("/v1/tags/solidaridad", beto)).toMatchObject({ tag: "solidaridad", display: "Solidaridad", postCount: 1, followedByMe: false });
    expect((await get<{ tags: TagView[] }>("/v1/tags?q=%23sol")).tags.map((x) => x.tag)).toEqual(["solidaridad"]);
    expect((await t.app.inject({ url: "/v1/tags/a" })).statusCode).toBe(400);
    expect((await post(ana, { text: "   " })).statusCode).toBe(400);
    expect((await t.app.inject({ method: "POST", url: "/v1/posts", payload: { text: "hola" } })).statusCode).toBe(401);
  });

  it("seguir una etiqueta la trae al feed Siguiendo, aunque aún no tenga posts", async () => {
    expect((await t.app.inject({ method: "PUT", url: "/v1/follows/tag/Ayuda_Mutua", headers: auth(beto) })).statusCode).toBe(200);
    expect((await get<TagView>("/v1/tags/ayuda_mutua", beto)).followedByMe).toBe(true);
    await post(carla, { text: "Centro de acopio abierto #AyudaMutua" });
    await post(carla, { text: "Centro de acopio en San Isidro #ayuda_mutua" });
    const following = await get<FeedResponse>("/v1/feed?tab=following", beto);
    expect(following.posts.map((p) => p.text)).toEqual(["Centro de acopio en San Isidro #ayuda_mutua"]);
    expect((await get<MyFollows>("/v1/me/follows", beto)).tags).toEqual([{ tag: "ayuda_mutua", display: "ayuda_mutua" }]);
    expect((await t.app.inject({ method: "DELETE", url: "/v1/follows/tag/AYUDA_MUTUA", headers: auth(beto) })).statusCode).toBe(200);
    expect((await get<MyFollows>("/v1/me/follows", beto)).tags).toEqual([]);
  });

  it("menciona un EVENT sin alimentar su pin ni su verificación", async () => {
    const r = await submit(t, carla, reportBody(carla, { category: "infra.power_outage", pin: LIMA, text: "Apagón #Lima" }));
    expect(r.body.outcome).toBe("CREATED_EVENT");
    await t.c.dispatcher.drain();
    const before = (await t.c.db.query(`SELECT count(*)::int AS n FROM event.evidence WHERE event_id = $1`, [r.body.eventId])).rows[0];
    const res = await post(ana, { text: "Fuerza a los vecinos", eventId: r.body.eventId });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().eventId).toBe(r.body.eventId);
    const after = (await t.c.db.query(`SELECT count(*)::int AS n FROM event.evidence WHERE event_id = $1`, [r.body.eventId])).rows[0];
    expect(after).toEqual(before);
    const link = await t.c.db.query(`SELECT link_type FROM social.post_event_links WHERE post_id = $1`, [res.json().postId]);
    expect(link.rows).toEqual([{ link_type: "MENTION" }]);
    // El texto de un reporte también se indexa.
    expect((await get<FeedResponse>("/v1/tags/lima/posts")).posts.map((p) => p.text)).toContain("Apagón #Lima");
    expect((await post(ana, { text: "x", eventId: "0190a000-0000-7000-8000-000000000000" })).statusCode).toBe(404);
  });

  it("borrar un post quita texto, etiquetas y media; un reporte no se borra desde aquí", async () => {
    const file = makeJpeg();
    const up = await t.app.inject({
      method: "POST", url: "/v1/media/uploads", headers: auth(beto),
      payload: { kind: "IMAGE", mime: "image/jpeg", sizeBytes: file.length, sha256: createHash("sha256").update(file).digest("hex"), width: 64, height: 48, capturedInApp: true },
    });
    const { mediaId, upload } = up.json();
    const u = new URL(upload.url);
    await t.app.inject({ method: "PUT", url: u.pathname + u.search, headers: upload.headers, payload: file });
    await t.app.inject({ method: "POST", url: `/v1/media/${mediaId}/complete`, headers: auth(beto) });
    await t.c.dispatcher.drain();
    const created = await post(beto, { text: "Foto del puente #Puente", mediaIds: [mediaId] });
    expect(created.statusCode, created.body).toBe(201);
    const { postId } = created.json();
    expect((await get<FeedResponse>("/v1/tags/puente/posts")).posts[0]!.media).toHaveLength(1);

    expect((await t.app.inject({ method: "DELETE", url: `/v1/posts/${postId}`, headers: auth(ana) })).statusCode).toBe(404);
    expect((await t.app.inject({ method: "DELETE", url: `/v1/posts/${postId}`, headers: auth(beto) })).statusCode).toBe(204);
    expect((await get<FeedResponse>("/v1/tags/puente/posts")).posts).toEqual([]);
    const m = (await t.c.db.query<{ state: string; storage_key_original: string | null }>(`SELECT state, storage_key_original FROM media.media WHERE id = $1`, [mediaId])).rows[0]!;
    expect(m).toEqual({ state: "DELETED", storage_key_original: null });
    expect((await t.app.inject({ method: "DELETE", url: `/v1/posts/${postId}`, headers: auth(beto) })).statusCode).toBe(404);

    const rep = await submit(t, beto, reportBody(beto, { category: "infra.power_outage", pin: LIMA }));
    expect((await t.app.inject({ method: "DELETE", url: `/v1/posts/${rep.body.postId}`, headers: auth(beto) })).statusCode).toBe(409);
  });

  it("tiene un límite por hora", async () => {
    const spam = await createUser(t, "spam");
    await t.c.db.query(
      `INSERT INTO social.posts (id, author_type, author_id, kind, text) SELECT gen_random_uuid(), 'PROFILE', $1, 'STANDARD', 'x' FROM generate_series(1, 20)`,
      [spam.profileId],
    );
    expect((await post(spam, { text: "uno más" })).statusCode).toBe(429);
  });
});

describe("spam coordinado y reputación baja (ADR 0031)", () => {
  let t: TestContext;
  const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });
  const post = async (u: TestUser, text: string) => {
    const res = await t.app.inject({ method: "POST", url: "/v1/posts", headers: auth(u), payload: { text } });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { postId: string }).postId;
  };
  const spamFlags = async () =>
    (await t.c.db.query<{ target_id: string }>(`SELECT target_id FROM moderation.flags WHERE reason = 'SPAM' ORDER BY target_id`)).rows.map((r) => r.target_id);

  beforeAll(async () => {
    t = await createTestContext();
  });
  afterAll(async () => t.close());

  it("la huella ignora mayúsculas, tildes, signos y espacios; los textos cortos no cuentan", () => {
    expect(textFingerprintBase("¡Donen AQUÍ ya, cuenta 123 del banco solidario!")).toBe(textFingerprintBase("donen aqui ya cuenta 123 del banco solidario 🙏"));
    expect(textFingerprintBase("Ayuda por favor")).toBeNull();
  });

  it("el mismo texto de tres cuentas distintas en pocas horas va a moderación; nada se oculta solo", async () => {
    const [u1, u2, u3, u4] = await Promise.all(["spam1", "spam2", "spam3", "corto"].map((n) => createUser(t, n)));
    const p1 = await post(u1!, "Donen aquí YA: cuenta 123-456 del banco solidario");
    const p1b = await post(u1!, "donen aqui ya cuenta 123456 del banco solidario");
    const p2 = await post(u2!, "¡Donen aquí ya! Cuenta 123 456, del banco solidario");
    await t.c.dispatcher.drain();
    expect(await spamFlags()).toEqual([]);
    const p3 = await post(u3!, "Donen aquí ya cuenta 123456 del banco solidario 🙏");
    for (const u of [u2!, u3!, u4!]) await post(u, "Ayuda por favor");
    await t.c.dispatcher.drain();
    expect(await spamFlags()).toEqual([p1, p1b, p2, p3].sort());
    const visible = await t.c.db.query(`SELECT 1 FROM social.posts WHERE id = ANY($1) AND moderation_state = 'VISIBLE'`, [[p1, p2, p3]]);
    expect(visible.rowCount).toBe(3);
  });

  it("un autor con reputación baja sigue visible pero queda detrás en Para ti; al revertirse la sanción vuelve", async () => {
    const [lector, dora, eva] = await Promise.all(["lector", "dora", "eva"].map((n) => createUser(t, n, 24 * 40)));
    const doraPost = await post(dora!, "Corte de agua en mi cuadra desde la mañana");
    const evaPost = await post(eva!, "Semáforo apagado en la esquina del mercado");
    const order = async () => {
      const feed = (await t.app.inject({ url: "/v1/feed?tab=for_you", headers: auth(lector!) })).json() as FeedResponse;
      return feed.posts.map((p) => p.id).filter((id) => id === doraPost || id === evaPost);
    };
    expect(await order()).toEqual([evaPost, doraPost]);

    const sanction = (actionId: string, action: string, reverses: string | null = null) =>
      withTransaction(t.c.db, (tx) => publish(tx, "ModerationActionTaken", { actionId, targetType: "POST", targetId: randomUUID(), action, actor: "MODERATOR", affectedUserId: eva!.userId, reverses }));
    const first = randomUUID();
    await sanction(first, "REMOVE");
    await sanction(randomUUID(), "HIDE");
    await t.c.dispatcher.drain();
    const low = async () => (await t.c.db.query<{ low_trust: boolean }>(`SELECT low_trust FROM social.profiles WHERE id = $1`, [eva!.profileId])).rows[0]!.low_trust;
    expect(await low()).toBe(true);
    expect(await order()).toEqual([doraPost, evaPost]);

    await sanction(randomUUID(), "RESTORE", first);
    await t.c.dispatcher.drain();
    expect(await low()).toBe(false);
    expect(await order()).toEqual([evaPost, doraPost]);
    expect(await t.c.trust.refreshStanding()).toEqual({ checked: 0, changed: 0 });
  });
});
