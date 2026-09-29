import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, type TestContext } from "./helpers.js";

// Idioma detectado del contenido (ADR 0091). NO AI REQUIRED.
let t: TestContext;
beforeAll(async () => { t = await createTestContext(); });
afterAll(async () => { await t.close(); });

describe("idioma del post (ADR 0091)", () => {
  it("se detecta al publicar y sale en el feed; un texto corto queda sin idioma", async () => {
    const u = await createUser(t, "idioma_post");
    const post = async (text: string) => (await t.app.inject({ method: "POST", url: "/v1/posts", headers: { authorization: `Bearer ${u.token}` }, payload: { text } })).json().postId as string;
    const en = await post("There is a lot of smoke on the street and the firefighters are coming");
    const short = await post("ok gracias");
    const feed = (await t.app.inject({ url: `/v1/profiles/${(await t.app.inject({ url: "/v1/me", headers: { authorization: `Bearer ${u.token}` } })).json().handle}/posts` })).json();
    const byId = new Map((feed.posts as { id: string; lang: string | null }[]).map((p) => [p.id, p.lang]));
    expect(byId.get(en)).toBe("en");
    expect(byId.get(short)).toBeNull();
  });
});
