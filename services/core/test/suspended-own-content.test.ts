import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, reportBody, submit, type TestContext } from "./helpers.js";

// Una cuenta suspendida puede quitar lo suyo (ADR 0237): comentarios y reportes, además de posts.
describe("cuenta suspendida y su propio contenido", () => {
  let t: TestContext;
  beforeAll(async () => { t = await createTestContext(); });
  afterAll(async () => { await t.close(); });

  it("borra sus comentarios y retira sus reportes, pero sigue sin comentar", async () => {
    const u = await createUser(t, "suspendida_propio");
    const auth = { authorization: `Bearer ${u.token}` };
    const r = await submit(t, u, reportBody(u));
    const post = (await t.app.inject({ method: "POST", url: "/v1/posts", headers: auth, payload: { text: "Mi post" } })).json() as { postId: string };
    const comment = (await t.app.inject({ method: "POST", url: `/v1/posts/${post.postId}/comments`, headers: auth, payload: { text: "Mi comentario" } })).json() as { id: string };
    await t.c.identity.setUserStatus(t.c.db, u.userId, "SUSPENDED");

    expect((await t.app.inject({ method: "POST", url: `/v1/posts/${post.postId}/comments`, headers: auth, payload: { text: "otro" } })).json().error).toBe("ACCOUNT_SUSPENDED");
    expect((await t.app.inject({ method: "DELETE", url: `/v1/comments/${comment.id}`, headers: auth })).statusCode).toBe(204);
    expect((await t.app.inject({ method: "DELETE", url: `/v1/me/reports/${r.body.reportId}`, headers: auth })).statusCode).toBe(204);
  });
});
