import type { FeedResponse } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, type TestContext, type TestUser } from "./helpers.js";

// Búsqueda de publicaciones por texto (ADR 0107).
let t: TestContext;
const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });
const search = async (q: string, u?: TestUser, extra = "") => {
  const res = await t.app.inject({ url: `/v1/search/posts?q=${encodeURIComponent(q)}${extra}`, ...(u ? { headers: auth(u) } : {}) });
  return { status: res.statusCode, body: res.json() as FeedResponse };
};
const post = async (u: TestUser, text: string) => {
  const res = await t.app.inject({ method: "POST", url: "/v1/posts", headers: auth(u), payload: { text, anonymityMode: "PUBLIC" } });
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as { postId: string }).postId;
};

beforeAll(async () => { t = await createTestContext(); });
afterAll(() => t.close());

describe("buscar publicaciones", () => {
  it("encuentra por texto sin distinguir mayúsculas, por recientes y con páginas", async () => {
    const ana = await createUser(t, "ana_busca");
    const a = await post(ana, "Agua potable en el colegio San Martín");
    const b = await post(ana, "Reparten AGUA POTABLE en la plaza");
    await post(ana, "Corte de luz en el barrio");
    const r = await search("agua potable");
    expect(r.status).toBe(200);
    expect(r.body.posts.map((p) => p.id)).toEqual([b, a]);
    const page1 = await search("potable", undefined, "&limit=1");
    expect(page1.body.posts.map((p) => p.id)).toEqual([b]);
    const page2 = await search("potable", undefined, `&limit=1&cursor=${page1.body.nextCursor}`);
    expect(page2.body.posts.map((p) => p.id)).toEqual([a]);
  });

  it("los comodines se buscan como texto y respeta bloqueos y borrados", async () => {
    const [bea, cai] = await Promise.all([createUser(t, "bea_busca"), createUser(t, "cai_busca")]);
    const pct = await post(bea, "Descuento 100% en linternas");
    await post(bea, "Linternas a mitad de precio");
    expect((await search("100%")).body.posts.map((p) => p.id)).toEqual([pct]);
    expect((await search("__%")).body.posts).toHaveLength(0);

    const { rows } = await t.c.db.query<{ handle: string }>(`SELECT handle FROM social.profiles WHERE id = $1`, [bea.profileId]);
    const blk = await t.app.inject({ method: "PUT", url: `/v1/blocks/${rows[0]!.handle}`, headers: auth(cai) });
    expect(blk.statusCode, blk.body).toBeLessThan(300);
    expect((await search("linternas", cai)).body.posts).toHaveLength(0);
    expect((await search("linternas")).body.posts).toHaveLength(2);
    expect((await t.app.inject({ method: "DELETE", url: `/v1/posts/${pct}`, headers: auth(bea) })).statusCode).toBeLessThan(300);
    expect((await search("linternas")).body.posts).toHaveLength(1);
  });

  it("valida la consulta", async () => {
    expect((await search("ag")).status).toBe(400);
    expect((await search("x".repeat(81))).status).toBe(400);
  });
});
