import type { BusinessView, FeedResponse, MyFollows } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, type TestContext, type TestUser } from "./helpers.js";

let t: TestContext;
let owner: TestUser;
let fan: TestUser;
let admin: TestUser;
const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });
const body = { handle: "Farmacia_Sol", name: "Farmacia Sol", category: "pharmacy", country: "PE", description: "Abierta 24 h", contactUrl: "https://farmaciasol.example" };

beforeAll(async () => {
  t = await createTestContext();
  owner = await createUser(t, "duena");
  fan = await createUser(t, "vecina");
  admin = await createUser(t, "admin_neg");
  await t.c.identity.grantRole(admin.userId, "admin");
  admin = { ...admin, token: (await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle: "admin_neg", platform: "ANDROID", deviceId: admin.deviceId } })).json().token };
});
afterAll(async () => t.close());

describe("perfiles de negocio", () => {
  it("se crean con handle único entre personas y negocios, y con límite por persona", async () => {
    const res = await t.app.inject({ method: "POST", url: "/v1/businesses", headers: auth(owner), payload: body });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ handle: "farmacia_sol", name: "Farmacia Sol", verification: "UNVERIFIED", isMine: true, followerCount: 0 });
    expect((await t.app.inject({ method: "POST", url: "/v1/businesses", headers: auth(fan), payload: body })).statusCode).toBe(409);
    const personHandle = (await t.c.db.query<{ handle: string }>(`SELECT handle FROM social.profiles WHERE id = $1`, [fan.profileId])).rows[0]!.handle;
    expect((await t.app.inject({ method: "POST", url: "/v1/businesses", headers: auth(owner), payload: { ...body, handle: personHandle } })).statusCode).toBe(409);
    expect((await t.app.inject({ method: "POST", url: "/v1/businesses", headers: auth(owner), payload: { ...body, handle: "x" } })).statusCode).toBe(400);
    expect((await t.app.inject({ method: "POST", url: "/v1/businesses", headers: auth(owner), payload: { ...body, handle: "otro_1", contactUrl: "http://inseguro.example" } })).statusCode).toBe(400);
    for (const h of ["otro_1", "otro_2"]) expect((await t.app.inject({ method: "POST", url: "/v1/businesses", headers: auth(owner), payload: { ...body, handle: h } })).statusCode).toBe(201);
    expect((await t.app.inject({ method: "POST", url: "/v1/businesses", headers: auth(owner), payload: { ...body, handle: "otro_3" } })).statusCode).toBe(409);
    expect((await t.app.inject({ url: "/v1/me/businesses", headers: auth(owner) })).json().businesses).toHaveLength(3);
  });

  it("solo quien lo administra edita y publica como el negocio, nunca de forma seudónima", async () => {
    const put = await t.app.inject({ method: "PUT", url: "/v1/businesses/farmacia_sol", headers: auth(owner), payload: { ...body, handle: undefined, description: "Agua y medicinas" } });
    expect(put.statusCode, put.body).toBe(200);
    expect(put.json().description).toBe("Agua y medicinas");
    expect((await t.app.inject({ method: "PUT", url: "/v1/businesses/farmacia_sol", headers: auth(fan), payload: body })).statusCode).toBe(404);

    const post = await t.app.inject({ method: "POST", url: "/v1/posts", headers: auth(owner), payload: { text: "Tenemos agua embotellada #Ayuda", asBusiness: "farmacia_sol" } });
    expect(post.statusCode, post.body).toBe(201);
    expect((await t.app.inject({ method: "POST", url: "/v1/posts", headers: auth(fan), payload: { text: "suplanto", asBusiness: "farmacia_sol" } })).statusCode).toBe(404);
    expect((await t.app.inject({ method: "POST", url: "/v1/posts", headers: auth(owner), payload: { text: "x", asBusiness: "farmacia_sol", anonymityMode: "PSEUDONYMOUS" } })).statusCode).toBe(400);

    const page = (await t.app.inject({ url: "/v1/businesses/farmacia_sol/posts", headers: auth(fan) })).json() as FeedResponse;
    expect(page.posts).toHaveLength(1);
    expect(page.posts[0]!.author).toEqual({ pseudonymous: false, handle: "farmacia_sol", displayName: "Farmacia Sol", avatarUrl: null, business: { verification: "UNVERIFIED" } });
    expect(page.posts[0]!.mine).toBe(false);
    const own = (await t.app.inject({ url: "/v1/businesses/farmacia_sol/posts", headers: auth(owner) })).json() as FeedResponse;
    expect(own.posts[0]!.mine).toBe(true);
    // No cuenta como post de la persona en su perfil.
    const handle = (await t.c.db.query<{ handle: string }>(`SELECT handle FROM social.profiles WHERE id = $1`, [owner.profileId])).rows[0]!.handle;
    expect((await t.app.inject({ url: `/v1/profiles/${handle}` })).json().postCount).toBe(0);
  });

  it("se sigue, aparece en Siguiendo y en la búsqueda; administración lo verifica", async () => {
    expect((await t.app.inject({ method: "PUT", url: "/v1/follows/business/Farmacia_Sol", headers: auth(fan) })).statusCode).toBe(200);
    expect(((await t.app.inject({ url: "/v1/me/follows", headers: auth(fan) })).json() as MyFollows).businesses).toEqual([{ handle: "farmacia_sol", name: "Farmacia Sol" }]);
    const following = (await t.app.inject({ url: "/v1/feed?tab=following", headers: auth(fan) })).json() as FeedResponse;
    expect(following.posts.map((p) => p.text)).toEqual(["Tenemos agua embotellada #Ayuda"]);
    expect((await t.app.inject({ url: "/v1/businesses/farmacia_sol", headers: auth(fan) })).json()).toMatchObject({ followerCount: 1, followedByMe: true, postCount: 1, isMine: false });

    expect((await t.app.inject({ method: "PUT", url: "/v1/admin/businesses/farmacia_sol/verification", headers: auth(owner), payload: { verification: "VERIFIED", reason: "Documentos revisados" } })).statusCode).toBe(403);
    const v = await t.app.inject({ method: "PUT", url: "/v1/admin/businesses/farmacia_sol/verification", headers: auth(admin), payload: { verification: "VERIFIED", reason: "Documentos revisados" } });
    expect(v.statusCode, v.body).toBe(200);
    const found = (await t.app.inject({ url: "/v1/businesses?q=farma" })).json().businesses as BusinessView[];
    expect(found[0]).toMatchObject({ handle: "farmacia_sol", verification: "VERIFIED" });
  });

  it("moderación puede retirarlo: desaparece con sus posts y no puede publicar", async () => {
    const flag = await t.app.inject({ method: "POST", url: "/v1/flags", headers: auth(fan), payload: { targetType: "BUSINESS", targetId: "farmacia_sol", reason: "SPAM" } });
    expect(flag.statusCode, flag.body).toBe(202);
    const caseId = (await t.c.db.query<{ id: string }>(`SELECT id FROM moderation.cases WHERE target_type = 'BUSINESS'`)).rows[0]!.id;
    const act = await t.app.inject({ method: "POST", url: `/v1/moderation/cases/${caseId}/actions`, headers: auth(admin), payload: { action: "REMOVE", reason: "Negocio falso que vende agua inexistente" } });
    expect(act.statusCode, act.body).toBe(200);
    expect((await t.app.inject({ url: "/v1/businesses/farmacia_sol", headers: auth(fan) })).statusCode).toBe(404);
    expect((await t.app.inject({ url: "/v1/businesses/farmacia_sol", headers: auth(owner) })).statusCode).toBe(200);
    expect(((await t.app.inject({ url: "/v1/feed?tab=following", headers: auth(fan) })).json() as FeedResponse).posts).toEqual([]);
    expect((await t.app.inject({ method: "POST", url: "/v1/posts", headers: auth(owner), payload: { text: "sigo aquí", asBusiness: "farmacia_sol" } })).statusCode).toBe(403);
  });

  it("borrar la cuenta borra sus negocios y deja el handle reservado", async () => {
    expect((await t.app.inject({ method: "DELETE", url: "/v1/me", headers: auth(owner), payload: { confirm: "DELETE" } })).statusCode).toBe(202);
    await t.c.dispatcher.drain();
    const rows = (await t.c.db.query<{ deleted: boolean }>(`SELECT deleted_at IS NOT NULL AS deleted FROM social.business_profiles WHERE owner_user_id = $1`, [owner.userId])).rows;
    expect(rows.every((r) => r.deleted)).toBe(true);
    expect((await t.app.inject({ method: "POST", url: "/v1/businesses", headers: auth(fan), payload: { ...body, handle: "otro_1" } })).statusCode).toBe(409);
  });
});
