import type { BusinessView, FeedResponse } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, type TestContext, type TestUser } from "./helpers.js";

let t: TestContext;
let owner: TestUser;
let fan: TestUser;
const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });
const feed = async (u: TestUser) => ((await t.app.inject({ url: "/v1/feed?tab=for_you", headers: auth(u) })).json() as FeedResponse).posts;

beforeAll(async () => {
  t = await createTestContext();
  owner = await createUser(t, "dueno_ferre");
  fan = await createUser(t, "vecino_ferre");
  expect((await t.app.inject({ method: "POST", url: "/v1/businesses", headers: auth(owner), payload: { handle: "ferreteria_luz", name: "Ferretería Luz", category: "hardware" } })).statusCode).toBe(201);
  await t.app.inject({ method: "POST", url: "/v1/posts", headers: auth(owner), payload: { text: "Tenemos linternas y pilas", anonymityMode: "PUBLIC", asBusiness: "ferreteria_luz" } });
});
afterAll(async () => t.close());

describe("menciones y bloqueo de negocios (ADR 0054)", () => {
  it("una @mención a un negocio se enlaza y se distingue de las personas", async () => {
    const person = (await t.c.db.query<{ handle: string }>(`SELECT handle FROM social.profiles WHERE id = $1`, [owner.profileId])).rows[0]!.handle;
    const res = await t.app.inject({ method: "POST", url: "/v1/posts", headers: auth(fan), payload: { text: `Gracias @Ferreteria_Luz y @${person} por las pilas`, anonymityMode: "PUBLIC" } });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().mentions.sort()).toEqual([person, "ferreteria_luz"].sort());
    const post = (await feed(owner)).find((p) => p.id === res.json().postId)!;
    expect(post.mentions.sort()).toEqual([person, "ferreteria_luz"].sort());
    expect(post.businessMentions).toEqual(["ferreteria_luz"]);
  });

  it("bloquear un negocio oculta sus posts, deja de seguirlo y se puede deshacer", async () => {
    await t.app.inject({ method: "PUT", url: "/v1/follows/business/ferreteria_luz", headers: auth(fan) });
    expect((await feed(fan)).some((p) => p.author.pseudonymous === false && p.author.handle === "ferreteria_luz")).toBe(true);

    expect((await t.app.inject({ method: "PUT", url: "/v1/blocks/ferreteria_luz", headers: auth(fan) })).statusCode).toBe(200);
    expect((await feed(fan)).some((p) => p.author.pseudonymous === false && p.author.handle === "ferreteria_luz")).toBe(false);
    const view = (await t.app.inject({ url: "/v1/businesses/ferreteria_luz", headers: auth(fan) })).json() as BusinessView;
    expect(view).toMatchObject({ blockedByMe: true, followedByMe: false });
    expect((await t.app.inject({ url: "/v1/me/blocks", headers: auth(fan) })).json().handles).toContain("ferreteria_luz");

    expect((await t.app.inject({ method: "DELETE", url: "/v1/blocks/ferreteria_luz", headers: auth(fan) })).statusCode).toBe(200);
    expect((await feed(fan)).some((p) => p.author.pseudonymous === false && p.author.handle === "ferreteria_luz")).toBe(true);
  });

  it("no se bloquea un negocio propio ni uno que no existe", async () => {
    expect((await t.app.inject({ method: "PUT", url: "/v1/blocks/ferreteria_luz", headers: auth(owner) })).statusCode).toBe(400);
    expect((await t.app.inject({ method: "PUT", url: "/v1/blocks/no_existe_x", headers: auth(fan) })).statusCode).toBe(404);
  });
});
