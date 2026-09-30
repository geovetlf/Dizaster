import { v7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, type TestContext, type TestUser } from "./helpers.js";

// Posts y comentarios idempotentes con id del cliente (ADR 0178, §13.1). NO AI REQUIRED.
let t: TestContext;
let u: TestUser;
let other: TestUser;
beforeAll(async () => {
  t = await createTestContext();
  u = await createUser(t, "idem");
  other = await createUser(t, "idem_other");
});
afterAll(async () => { await t.close(); });

const auth = (x: TestUser) => ({ authorization: `Bearer ${x.token}` });
const post = (x: TestUser, payload: object) => t.app.inject({ method: "POST", url: "/v1/posts", headers: auth(x), payload });
const countPosts = async (profileId: string) =>
  (await t.c.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM social.posts WHERE author_id = $1`, [profileId])).rows[0]!.n;

describe("reintentos idempotentes", () => {
  it("el mismo id del cliente devuelve el mismo post, también si llegan a la vez", async () => {
    const clientId = v7();
    const a = await post(u, { text: "Corte de agua #lima", clientId });
    expect(a.statusCode).toBe(201);
    const b = await post(u, { text: "Corte de agua #lima", clientId });
    expect(b.json()).toEqual(a.json());
    expect(a.json()).toMatchObject({ tags: ["lima"] });

    const c2 = v7();
    const both = await Promise.all([post(u, { text: "Doble toque", clientId: c2 }), post(u, { text: "Doble toque", clientId: c2 })]);
    expect(both.map((r) => r.statusCode)).toEqual([201, 201]);
    expect(both[0]!.json().postId).toBe(both[1]!.json().postId);
    expect(await countPosts(u.profileId)).toBe(2);

    // Sin id se crea cada vez (compatibilidad); el id de otra persona no le da acceso a nada.
    await post(u, { text: "Sin id" });
    await post(u, { text: "Sin id" });
    expect(await countPosts(u.profileId)).toBe(4);
    const foreign = await post(other, { text: "Mío", clientId });
    expect(foreign.json().postId).not.toBe(a.json().postId);
  });

  it("comentarios: el mismo id devuelve el mismo comentario; en otro post, 409", async () => {
    const p1 = (await post(u, { text: "Post A" })).json().postId as string;
    const p2 = (await post(u, { text: "Post B" })).json().postId as string;
    const clientId = v7();
    const send = (postId: string) =>
      t.app.inject({ method: "POST", url: `/v1/posts/${postId}/comments`, headers: auth(other), payload: { text: "Voy para allá", clientId } });
    const a = await send(p1);
    const b = await send(p1);
    expect(a.statusCode).toBe(201);
    expect(b.json().id).toBe(a.json().id);
    const n = (await t.c.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM social.comments WHERE post_id = $1`, [p1])).rows[0]!.n;
    expect(n).toBe(1);
    const c = await send(p2);
    expect(c.statusCode).toBe(409);
    expect(c.json()).toMatchObject({ error: "CLIENT_ID_REUSED" });
  });
});
