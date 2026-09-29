import type { FeedPost } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, type TestContext, type TestUser } from "./helpers.js";

// Contadores sociales mantenidos por triggers (ADR 0118).
let t: TestContext;
const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });
beforeAll(async () => { t = await createTestContext(); });
afterAll(() => t.close());

const view = async (id: string) => (await t.app.inject({ url: `/v1/posts/${id}` })).json() as FeedPost;
const stored = async (id: string) =>
  (await t.c.db.query<{ comment_count: number; share_count: number; reaction_counts: Record<string, number> }>(
    `SELECT comment_count, share_count, reaction_counts FROM social.posts WHERE id = $1`, [id])).rows[0]!;

describe("contadores de publicaciones", () => {
  it("siguen a comentarios, reacciones, compartidos, moderación y borrado de cuenta", async () => {
    const [ana, bea, cai] = await Promise.all([createUser(t, "cnt_ana"), createUser(t, "cnt_bea"), createUser(t, "cnt_cai")]);
    const post = (await t.app.inject({ method: "POST", url: "/v1/posts", headers: auth(ana), payload: { text: "Contadores", anonymityMode: "PUBLIC" } })).json().postId as string;

    const c1 = (await t.app.inject({ method: "POST", url: `/v1/posts/${post}/comments`, headers: auth(bea), payload: { text: "uno" } })).json().id as string;
    await t.app.inject({ method: "POST", url: `/v1/posts/${post}/comments`, headers: auth(cai), payload: { text: "dos" } });
    await t.app.inject({ method: "PUT", url: `/v1/posts/${post}/reactions/LIKE`, headers: auth(bea) });
    await t.app.inject({ method: "PUT", url: `/v1/posts/${post}/reactions/LIKE`, headers: auth(cai) });
    await t.app.inject({ method: "PUT", url: `/v1/posts/${post}/reactions/SUPPORT`, headers: auth(cai) });
    const share = await t.app.inject({ method: "POST", url: `/v1/posts/${post}/share`, headers: auth(bea), payload: {} });
    expect(share.statusCode, share.body).toBe(201);
    expect(await view(post)).toMatchObject({ commentCount: 2, likeCount: 2, shareCount: 1, reactions: { LIKE: 2, SUPPORT: 1 } });

    await t.app.inject({ method: "DELETE", url: `/v1/comments/${c1}`, headers: auth(bea) });
    await t.app.inject({ method: "DELETE", url: `/v1/posts/${post}/reactions/SUPPORT`, headers: auth(cai) });
    expect(await stored(post)).toEqual({ comment_count: 1, share_count: 1, reaction_counts: { LIKE: 2 } });

    // Moderación oculta el compartido; borrar la cuenta de cai quita su comentario y su reacción.
    await t.c.db.query(`UPDATE social.posts SET moderation_state = 'HIDDEN' WHERE shared_post_id = $1`, [post]);
    expect((await stored(post)).share_count).toBe(0);
    expect((await t.app.inject({ method: "DELETE", url: "/v1/me", headers: auth(cai), payload: { confirm: "DELETE" } })).statusCode).toBeLessThan(300);
    await t.c.dispatcher.drain();
    expect(await stored(post)).toEqual({ comment_count: 0, share_count: 0, reaction_counts: { LIKE: 1 } });
  });
});
