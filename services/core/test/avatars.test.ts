import { createHash } from "node:crypto";
import type { BusinessView, CommentView, FeedResponse, MyProfile, ProfileView } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, type TestContext, type TestUser } from "./helpers.js";
import { makeJpeg } from "./media-fixtures.js";

/** Foto de perfil y logo de negocio (ADR 0119). */
describe("foto de perfil y logo", () => {
  let t: TestContext;
  let ana: TestUser;
  let beto: TestUser;
  let mod: TestUser;
  let anaHandle: string;
  const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });
  const handleOf = async (u: TestUser) => (await t.c.db.query<{ handle: string }>(`SELECT handle FROM social.profiles WHERE id = $1`, [u.profileId])).rows[0]!.handle;
  const mediaState = async (id: string) => (await t.c.db.query<{ state: string }>(`SELECT state FROM media.media WHERE id = $1`, [id])).rows[0]!.state;
  const setAvatar = (u: TestUser, mediaId: string | null) => t.app.inject({ method: "PUT", url: "/v1/me/avatar", headers: auth(u), payload: { mediaId } });

  async function upload(u: TestUser, opts: { complete?: boolean } = {}): Promise<string> {
    const file = makeJpeg();
    const up = await t.app.inject({
      method: "POST", url: "/v1/media/uploads", headers: auth(u),
      payload: { kind: "IMAGE", mime: "image/jpeg", sizeBytes: file.length, sha256: createHash("sha256").update(file).digest("hex"), width: 64, height: 48, capturedInApp: false },
    });
    expect(up.statusCode, up.body).toBe(201);
    const { mediaId, upload: target } = up.json();
    const url = new URL(target.url);
    await t.app.inject({ method: "PUT", url: url.pathname + url.search, headers: target.headers, payload: file });
    if (opts.complete !== false) {
      await t.app.inject({ method: "POST", url: `/v1/media/${mediaId}/complete`, headers: auth(u) });
      await t.c.dispatcher.drain();
    }
    return mediaId;
  }

  beforeAll(async () => {
    t = await createTestContext();
    ana = await createUser(t, "ana");
    beto = await createUser(t, "beto");
    const m = await createUser(t, "moderadora");
    await t.c.identity.grantRole(m.userId, "moderator");
    mod = { ...m, token: (await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle: "moderadora", platform: "ANDROID", deviceId: m.deviceId } })).json().token };
    anaHandle = await handleOf(ana);
  });
  afterAll(async () => t.close());

  it("pone la miniatura saneada en el perfil, los posts y los comentarios; cambiarla purga la anterior", async () => {
    const first = await upload(ana);
    const res = await setAvatar(ana, first);
    expect(res.statusCode, res.body).toBe(200);
    const me = res.json() as MyProfile;
    expect(me.avatarUrl).toMatch(/^https?:\/\//);

    const profile = (await t.app.inject({ url: `/v1/profiles/${anaHandle}` })).json() as ProfileView;
    expect(profile.avatarUrl).toBe(me.avatarUrl);
    const created = await t.app.inject({ method: "POST", url: "/v1/posts", headers: auth(ana), payload: { text: "Con foto #avatares" } });
    const { postId } = created.json();
    const feed = (await t.app.inject({ url: "/v1/tags/avatares/posts" })).json() as FeedResponse;
    expect(feed.posts[0]!.author).toMatchObject({ pseudonymous: false, handle: anaHandle, avatarUrl: me.avatarUrl });
    await t.app.inject({ method: "POST", url: `/v1/posts/${postId}/comments`, headers: auth(ana), payload: { text: "hola" } });
    const { comments } = (await t.app.inject({ url: `/v1/posts/${postId}/comments` })).json() as { comments: CommentView[] };
    expect(comments[0]!.author.avatarUrl).toBe(me.avatarUrl);

    const second = await upload(ana);
    expect((await setAvatar(ana, second)).statusCode).toBe(200);
    expect(await mediaState(first)).toBe("DELETED");
    expect(await mediaState(second)).toBe("READY");

    // La foto de perfil no se adjunta a un post (borrar el post se la llevaría).
    expect((await t.app.inject({ method: "POST", url: "/v1/posts", headers: auth(ana), payload: { text: "x", mediaIds: [second] } })).statusCode).toBe(409);

    const cleared = (await setAvatar(ana, null)).json() as MyProfile;
    expect(cleared.avatarUrl).toBeNull();
    expect(await mediaState(second)).toBe("DELETED");
  });

  it("solo media propia, procesada y que no esté en un post", async () => {
    const other = await upload(beto);
    expect((await setAvatar(ana, other)).statusCode).toBe(400);
    const pending = await upload(ana, { complete: false });
    expect((await setAvatar(ana, pending)).statusCode).toBe(400);
    const inPost = await upload(ana);
    expect((await t.app.inject({ method: "POST", url: "/v1/posts", headers: auth(ana), payload: { text: "foto", mediaIds: [inPost] } })).statusCode).toBe(201);
    expect((await setAvatar(ana, inPost)).statusCode).toBe(409);
    expect((await setAvatar(ana, "no-es-uuid" as string)).statusCode).toBe(400);
    expect((await t.app.inject({ method: "PUT", url: "/v1/me/avatar", payload: { mediaId: null } })).statusCode).toBe(401);
  });

  it("el logo solo lo cambia quien administra el negocio; aparece en su página y en sus posts", async () => {
    const body = { handle: "panaderia_ana", name: "Panadería Ana", category: "food" };
    expect((await t.app.inject({ method: "POST", url: "/v1/businesses", headers: auth(ana), payload: body })).statusCode).toBe(201);
    const logo = await upload(ana);
    expect((await t.app.inject({ method: "PUT", url: "/v1/businesses/panaderia_ana/logo", headers: auth(beto), payload: { mediaId: logo } })).statusCode).toBe(404);
    const res = await t.app.inject({ method: "PUT", url: "/v1/businesses/panaderia_ana/logo", headers: auth(ana), payload: { mediaId: logo } });
    expect(res.statusCode, res.body).toBe(200);
    const view = res.json() as BusinessView;
    expect(view.logoUrl).toMatch(/^https?:\/\//);
    expect(((await t.app.inject({ url: "/v1/businesses/panaderia_ana" })).json() as BusinessView).logoUrl).toBe(view.logoUrl);

    await t.app.inject({ method: "POST", url: "/v1/posts", headers: auth(ana), payload: { text: "Pan caliente #logos", asBusiness: "panaderia_ana" } });
    const feed = (await t.app.inject({ url: "/v1/tags/logos/posts" })).json() as FeedResponse;
    expect(feed.posts[0]!.author).toMatchObject({ avatarUrl: view.logoUrl });
  });

  it("moderación quita la foto sin tocar la cuenta y queda registrado", async () => {
    const photo = await upload(beto);
    expect((await setAvatar(beto, photo)).statusCode).toBe(200);
    const betoHandle = await handleOf(beto);
    expect((await t.app.inject({ method: "POST", url: "/v1/flags", headers: auth(ana), payload: { targetType: "PROFILE", targetId: betoHandle, reason: "HARASSMENT" } })).statusCode).toBeLessThan(300);
    const caseId = (await t.c.db.query<{ id: string }>(`SELECT id FROM moderation.cases WHERE target_type = 'PROFILE' AND target_id = $1`, [beto.profileId])).rows[0]!.id;
    const acted = await t.app.inject({ method: "POST", url: `/v1/moderation/cases/${caseId}/actions`, headers: auth(mod), payload: { action: "REMOVE_AVATAR", reason: "Foto ofensiva en el perfil" } });
    expect(acted.statusCode, acted.body).toBe(200);
    expect(((await t.app.inject({ url: `/v1/profiles/${betoHandle}` })).json() as ProfileView).avatarUrl).toBeNull();
    expect(await mediaState(photo)).toBe("DELETED");
    const log = await t.c.db.query(`SELECT 1 FROM moderation.actions WHERE action = 'REMOVE_AVATAR' AND target_id = $1`, [beto.profileId]);
    expect(log.rowCount).toBe(1);
    // No se puede aplicar a un post.
    const { rows } = await t.c.db.query<{ id: string }>(`SELECT id FROM social.posts WHERE author_id = $1 LIMIT 1`, [ana.profileId]);
    await t.app.inject({ method: "POST", url: "/v1/flags", headers: auth(beto), payload: { targetType: "POST", targetId: rows[0]!.id, reason: "SPAM" } });
    const postCase = (await t.c.db.query<{ id: string }>(`SELECT id FROM moderation.cases WHERE target_type = 'POST' AND target_id = $1`, [rows[0]!.id])).rows[0]!.id;
    expect((await t.app.inject({ method: "POST", url: `/v1/moderation/cases/${postCase}/actions`, headers: auth(mod), payload: { action: "REMOVE_AVATAR", reason: "No aplica a posts" } })).statusCode).toBe(400);
  });

  it("borrar la cuenta quita la foto", async () => {
    const photo = await upload(ana);
    expect((await setAvatar(ana, photo)).statusCode).toBe(200);
    await t.c.social.anonymizeProfile(t.c.db, ana.profileId);
    const r = (await t.c.db.query<{ avatar_url: string | null }>(`SELECT avatar_url FROM social.profiles WHERE id = $1`, [ana.profileId])).rows[0]!;
    expect(r.avatar_url).toBeNull();
  });
});
