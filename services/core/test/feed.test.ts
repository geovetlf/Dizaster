import { createHash } from "node:crypto";
import type { FeedResponse } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, LIMA, offset, reportBody, submit, type TestContext, type TestUser } from "./helpers.js";
import { makeJpeg, makeMp4 } from "./media-fixtures.js";

let t: TestContext;
beforeAll(async () => { t = await createTestContext(); });
afterAll(async () => { await t.close(); });

const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });
const feed = async (qs: string, u?: TestUser) => {
  const res = await t.app.inject({ url: `/v1/feed?${qs}`, ...(u ? { headers: auth(u) } : {}) });
  expect(res.statusCode).toBe(200);
  return res.json() as FeedResponse;
};

async function upload(u: TestUser, file: Buffer, over: Record<string, unknown> = {}) {
  const sha256 = createHash("sha256").update(file).digest("hex");
  const res = await t.app.inject({ method: "POST", url: "/v1/media/uploads", headers: auth(u), payload: { kind: "IMAGE", mime: "image/jpeg", sizeBytes: file.length, sha256, ...over } });
  const { mediaId, upload: up } = res.json();
  const url = new URL(up.url);
  await t.app.inject({ method: "PUT", url: url.pathname + url.search, headers: up.headers, payload: file });
  await t.app.inject({ method: "POST", url: `/v1/media/${mediaId}/complete`, headers: auth(u) });
  await t.c.dispatcher.drain();
  return mediaId as string;
}

describe("feed", () => {
  let author: TestUser;
  let hidden: TestUser;
  const FAR = { lat: -16.4, lng: -71.54 }; // Arequipa

  beforeAll(async () => {
    author = await createUser(t, "feed_author");
    hidden = await createUser(t, "feed_hidden");
    const photo = await upload(author, makeJpeg());
    await submit(t, author, { ...reportBody(author, { category: "fire.structure", pin: offset(LIMA, 3000), text: "Humo en el edificio" }), mediaIds: [photo] });
    const video = await upload(author, makeMp4(), { kind: "VIDEO_RECORDED", mime: "video/mp4", durationMs: 24_000 });
    await submit(t, author, { ...reportBody(author, { category: "accident.traffic", pin: offset(LIMA, 6000), text: "Choque" }), mediaIds: [video] });
    await submit(t, hidden, { ...reportBody(hidden, { category: "crime.robbery", pin: FAR, text: "Robo" }), anonymityMode: "PSEUDONYMOUS" });
    await t.c.dispatcher.drain(); // proyecta severidad y estado de cada evento para el orden del feed
  });

  it("para ti: orden determinista (a igual recencia, más grave primero), con autor, categoría, estado y media saneada", async () => {
    const { posts } = await feed("tab=for_you", author);
    // Incendio (severidad 4) sobre robo y choque (3); entre iguales, el más reciente.
    expect(posts.map((p) => p.text)).toEqual(["Humo en el edificio", "Robo", "Choque"]);
    const fire = posts[0]!;
    expect(fire).toMatchObject({ kind: "REPORT", categoryCode: "fire.structure", author: { pseudonymous: false }, likeCount: 0, commentCount: 0, likedByMe: false });
    expect(fire.event?.publicVerificationState).toBeTruthy();
    expect(fire.media).toHaveLength(1);
    expect(fire.media[0]!.url).not.toContain("originals/");
  });

  it("los posts seudónimos no revelan al autor", async () => {
    const { posts } = await feed("tab=for_you");
    const robbery = posts.find((p) => p.text === "Robo")!;
    expect(robbery.author).toEqual({ pseudonymous: true });
    expect(JSON.stringify(robbery)).not.toContain("feed_hidden");
  });

  it("filtra por categoría raíz", async () => {
    const { posts } = await feed("tab=for_you&category=fire");
    expect(posts.map((p) => p.categoryCode)).toEqual(["fire.structure"]);
  });

  it("cerca de ti: solo lo que está dentro del radio, con distancia en tramos", async () => {
    const { posts } = await feed(`tab=nearby&lat=${LIMA.lat}&lng=${LIMA.lng}`);
    expect(posts.map((p) => p.text)).toEqual(["Choque", "Humo en el edificio"]);
    expect(posts.map((p) => p.distanceBucket)).toEqual(["<10km", "<5km"]);
    expect((await feed("tab=nearby")).posts).toEqual([]);
  });

  it("videos: solo posts con video", async () => {
    const { posts } = await feed("tab=videos");
    expect(posts.map((p) => p.text)).toEqual(["Choque"]);
    expect(posts[0]!.media[0]).toMatchObject({ kind: "VIDEO_RECORDED", durationMs: 24_000 });
  });

  it("siguiendo: vacío sin sesión o sin nada seguido", async () => {
    expect((await feed("tab=following")).posts).toEqual([]);
    expect((await feed("tab=following", author)).posts).toEqual([]);
  });

  it("paginación por cursor sin repetir ni saltar", async () => {
    const first = await feed("tab=for_you&limit=2");
    expect(first.posts).toHaveLength(2);
    const second = await feed(`tab=for_you&limit=2&cursor=${first.nextCursor}`);
    expect(second.posts.map((p) => p.text)).toEqual(["Choque"]);
    expect(first.posts.map((p) => p.text)).toEqual(["Humo en el edificio", "Robo"]);
    expect(second.nextCursor).toBeNull();
    expect((await t.app.inject({ url: "/v1/feed?cursor=basura" })).statusCode).toBe(400);
  });

  it("me gusta idempotente y comentarios", async () => {
    const reader = await createUser(t, "feed_reader");
    const post = (await feed("tab=for_you")).posts.find((p) => p.text === "Choque")!;
    const like = () => t.app.inject({ method: "PUT", url: `/v1/posts/${post.id}/like`, headers: auth(reader) });
    expect((await like()).json()).toEqual({ likeCount: 1, likedByMe: true });
    expect((await like()).json()).toEqual({ likeCount: 1, likedByMe: true });
    expect((await feed("tab=for_you", reader)).posts.find((p) => p.id === post.id)).toMatchObject({ likeCount: 1, likedByMe: true });
    expect((await feed("tab=for_you", author)).posts.find((p) => p.id === post.id)).toMatchObject({ likeCount: 1, likedByMe: false });
    const unlike = await t.app.inject({ method: "DELETE", url: `/v1/posts/${post.id}/like`, headers: auth(reader) });
    expect(unlike.json()).toEqual({ likeCount: 0, likedByMe: false });

    const c = await t.app.inject({ method: "POST", url: `/v1/posts/${post.id}/comments`, headers: auth(reader), payload: { text: "  ¿Hay heridos?  " } });
    expect(c.statusCode).toBe(201);
    expect(c.json()).toMatchObject({ text: "¿Hay heridos?", author: { displayName: "feed_reader" } });
    expect((await t.app.inject({ url: `/v1/posts/${post.id}/comments` })).json().comments).toHaveLength(1);
    expect((await feed("tab=for_you")).posts.find((p) => p.id === post.id)!.commentCount).toBe(1);
    expect((await t.app.inject({ method: "POST", url: `/v1/posts/${post.id}/comments`, headers: auth(reader), payload: { text: "" } })).statusCode).toBe(400);
    expect((await t.app.inject({ method: "POST", url: `/v1/posts/${post.id}/comments`, payload: { text: "x" } })).statusCode).toBe(401);
  });

  it("reacciones de contexto: por tipo, idempotentes y sin tocar la verificación", async () => {
    const reader = await createUser(t, "feed_ctx");
    const post = (await feed("tab=for_you")).posts.find((p) => p.text === "Robo")!;
    const react = (kind: string, method: "PUT" | "DELETE" = "PUT", u = reader) =>
      t.app.inject({ method, url: `/v1/posts/${post.id}/reactions/${kind}`, headers: auth(u) });
    const before = (await t.app.inject({ url: `/v1/events/${post.event!.id}` })).json();
    expect((await react("SUPPORT")).json()).toEqual({ reactions: { SUPPORT: 1 }, myReactions: ["SUPPORT"] });
    expect((await react("SEEN_TOO")).json()).toEqual({ reactions: { SEEN_TOO: 1, SUPPORT: 1 }, myReactions: ["SEEN_TOO", "SUPPORT"] });
    expect((await react("SEEN_TOO")).json().reactions.SEEN_TOO).toBe(1);
    await t.c.dispatcher.drain();
    const after = (await t.app.inject({ url: `/v1/events/${post.event!.id}` })).json();
    expect(after).toMatchObject({ reportCount: before.reportCount, publicVerificationState: before.publicVerificationState });

    const seen = (await feed("tab=for_you", reader)).posts.find((p) => p.id === post.id)!;
    expect(seen).toMatchObject({ reactions: { SEEN_TOO: 1, SUPPORT: 1 }, myReactions: ["SEEN_TOO", "SUPPORT"], likeCount: 0, likedByMe: false });
    expect((await feed("tab=for_you")).posts.find((p) => p.id === post.id)!.myReactions).toEqual([]);
    expect((await react("SUPPORT", "DELETE")).json()).toEqual({ reactions: { SEEN_TOO: 1 }, myReactions: ["SEEN_TOO"] });
    expect((await react("ANGRY")).statusCode).toBe(400);
    expect((await t.app.inject({ method: "PUT", url: `/v1/posts/${post.id}/reactions/USEFUL` })).statusCode).toBe(401);

    // Sin evento no hay "yo también lo vi".
    const plain = await t.app.inject({ method: "POST", url: "/v1/posts", headers: auth(reader), payload: { text: "Un post sin evento" } });
    const res = await t.app.inject({ method: "PUT", url: `/v1/posts/${plain.json().postId}/reactions/SEEN_TOO`, headers: auth(reader) });
    expect(res.statusCode).toBe(422);
    expect((await t.app.inject({ method: "PUT", url: `/v1/posts/${plain.json().postId}/reactions/USEFUL`, headers: auth(reader) })).statusCode).toBe(200);
  });

  it("feed de un evento: sus reportes y los posts que lo mencionan, nada más", async () => {
    const post = (await feed("tab=for_you")).posts.find((p) => p.text === "Choque")!;
    const eventId = post.event!.id;
    const u = await createUser(t, "feed_event_poster");
    const about = await t.app.inject({ method: "POST", url: "/v1/posts", headers: auth(u), payload: { text: "Tráfico desviado por el choque", eventId } });
    expect(about.statusCode).toBe(201);
    const res = await t.app.inject({ url: `/v1/events/${eventId}/posts` });
    const texts = (res.json() as { posts: { text: string; event: { id: string } }[] }).posts.map((p) => p.text);
    expect(texts[0]).toBe("Tráfico desviado por el choque");
    expect(texts).toContain("Choque");
    expect(texts).not.toContain("Robo");
    expect((await t.app.inject({ url: "/v1/events/00000000-0000-7000-8000-000000000000/posts" })).statusCode).toBe(404);
  });

  it("los posts ocultos por moderación no aparecen ni aceptan interacción", async () => {
    const u = await createUser(t, "feed_mod");
    const r = await submit(t, u, reportBody(u, { pin: offset(LIMA, 9000), text: "ocultar" }));
    await t.c.db.query(`UPDATE social.posts SET moderation_state = 'HIDDEN' WHERE id = $1`, [r.body.postId]);
    expect((await feed("tab=for_you&limit=30")).posts.some((p) => p.text === "ocultar")).toBe(false);
    expect((await t.app.inject({ method: "PUT", url: `/v1/posts/${r.body.postId}/like`, headers: auth(u) })).statusCode).toBe(404);
  });
});
