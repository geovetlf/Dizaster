import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, type TestContext, type TestUser } from "./helpers.js";

// Una publicación por enlace (ADR 0083): mismas reglas que el feed.
let t: TestContext;
let author: TestUser;
let reader: TestUser;
const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });
const handleOf = async (u: TestUser) => (await t.c.db.query<{ handle: string }>(`SELECT handle FROM social.profiles WHERE id = $1`, [u.profileId])).rows[0]!.handle;

beforeAll(async () => {
  t = await createTestContext();
  author = await createUser(t, "autora_enlace");
  reader = await createUser(t, "lector_enlace");
});
afterAll(async () => { await t.close(); });

describe("publicación por enlace", () => {
  it("se ve con o sin sesión; un bloqueo, la moderación o el borrado la esconden", async () => {
    const created = await t.app.inject({ method: "POST", url: "/v1/posts", headers: auth(author), payload: { text: "Calle cerrada por obras #lima" } });
    expect(created.statusCode).toBe(201);
    const id = created.json().postId as string;
    expect(id, created.body).toBeTruthy();

    const anon = await t.app.inject({ url: `/v1/posts/${id}` });
    expect(anon.statusCode, anon.body).toBe(200);
    expect(anon.headers["cache-control"]).toBe("no-store");
    expect(anon.json()).toMatchObject({ id, text: "Calle cerrada por obras #lima", author: { pseudonymous: false } });
    expect((await t.app.inject({ url: `/v1/posts/${id}`, headers: auth(author) })).json().mine).toBe(true);

    expect((await t.app.inject({ method: "PUT", url: `/v1/blocks/${await handleOf(author)}`, headers: auth(reader) })).statusCode).toBe(200);
    expect((await t.app.inject({ url: `/v1/posts/${id}`, headers: auth(reader) })).statusCode).toBe(404);

    await t.c.social.setPostModeration(t.c.db, id, "HIDDEN");
    expect((await t.app.inject({ url: `/v1/posts/${id}` })).statusCode).toBe(404);
    expect((await t.app.inject({ url: "/v1/posts/no-es-un-id" })).statusCode).toBe(400);
  });
});
