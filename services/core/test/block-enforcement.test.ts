import type { FeedResponse } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { roundNear } from "../src/modules/feed/index.js";
import { createTestContext, createUser, type TestContext, type TestUser } from "./helpers.js";

// Bloqueo efectivo y feed "Cerca" sin precisión explotable (§13.3, §8.5, ADR 0221). NO AI REQUIRED.
let t: TestContext;
let ana: TestUser;
let beto: TestUser;
let anaHandle: string;
const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });
const inject = (u: TestUser, method: "PUT" | "POST", url: string, payload?: object) => t.app.inject({ method, url, headers: auth(u), ...(payload ? { payload } : {}) });
const post = async (u: TestUser, payload: object) => (await inject(u, "POST", "/v1/posts", payload)).json().postId as string;

beforeAll(async () => {
  t = await createTestContext();
  ana = await createUser(t, "ana_bloquea");
  beto = await createUser(t, "beto_bloqueado");
  anaHandle = (await t.c.db.query<{ handle: string }>(`SELECT handle FROM social.profiles WHERE id = $1`, [ana.profileId])).rows[0]!.handle;
});
afterAll(() => t.close());

describe("quien fue bloqueado no puede interactuar", () => {
  it("no comenta, no reacciona, no comparte y no vuelve a seguir; sí puede quitar su reacción", async () => {
    const id = await post(ana, { text: "Corte de agua en Surco" });
    expect((await inject(beto, "PUT", `/v1/posts/${id}/reactions/LIKE`)).statusCode).toBe(200);
    const comment = (await inject(beto, "POST", `/v1/posts/${id}/comments`, { text: "Gracias por avisar" })).json().id as string;
    const betoHandle = (await t.c.db.query<{ handle: string }>(`SELECT handle FROM social.profiles WHERE id = $1`, [beto.profileId])).rows[0]!.handle;
    expect((await inject(ana, "PUT", `/v1/blocks/${betoHandle}`)).statusCode).toBe(200);

    expect((await inject(beto, "POST", `/v1/posts/${id}/comments`, { text: "Otra vez" })).json()).toMatchObject({ error: "BLOCKED" });
    expect((await inject(beto, "PUT", `/v1/posts/${id}/reactions/USEFUL`)).json()).toMatchObject({ error: "BLOCKED" });
    expect((await inject(beto, "POST", `/v1/posts/${id}/share`, {})).json()).toMatchObject({ error: "BLOCKED" });
    expect((await inject(beto, "PUT", `/v1/follows/profile/${anaHandle}`)).json()).toMatchObject({ error: "BLOCKED" });
    expect((await t.app.inject({ method: "DELETE", url: `/v1/posts/${id}/reactions/LIKE`, headers: auth(beto) })).statusCode).toBe(200);

    // Tampoco responde a comentarios de quien lo bloqueó en posts ajenos.
    const cata = await createUser(t, "cata_neutral");
    const other = await post(cata, { text: "Tráfico en la Panamericana" });
    const anaComment = (await inject(ana, "POST", `/v1/posts/${other}/comments`, { text: "Mucho tráfico" })).json().id as string;
    expect((await inject(beto, "POST", `/v1/posts/${other}/comments`, { text: "Respuesta", parentId: anaComment })).json()).toMatchObject({ error: "BLOCKED" });
    expect((await inject(beto, "POST", `/v1/posts/${other}/comments`, { text: "Comentario suelto" })).statusCode).toBe(201);
    // Ni reacciona a sus comentarios (ADR 0252).
    expect((await inject(beto, "PUT", `/v1/comments/${anaComment}/reactions/LIKE`)).json()).toMatchObject({ error: "BLOCKED" });
    expect((await t.app.inject({ method: "DELETE", url: `/v1/comments/${anaComment}/reactions/LIKE`, headers: auth(beto) })).statusCode).toBe(200);
    expect(comment).toBeTruthy();
  });

  it("en un post seudónimo no se aplica: rechazar revelaría a su autor", async () => {
    const id = await post(ana, { text: "Aviso anónimo", anonymityMode: "PSEUDONYMOUS" });
    expect((await inject(beto, "POST", `/v1/posts/${id}/comments`, { text: "Ok" })).statusCode).toBe(201);
  });
});

describe("comentarios borrados (ADR 0252)", () => {
  it("borrar un comentario propio vacía su texto", async () => {
    const id = await post(ana, { text: "Lluvia fuerte" });
    const cid = (await inject(ana, "POST", `/v1/posts/${id}/comments`, { text: "Texto a borrar" })).json().id as string;
    expect((await t.app.inject({ method: "DELETE", url: `/v1/comments/${cid}`, headers: auth(ana) })).statusCode).toBe(204);
    expect((await t.c.db.query<{ text: string }>(`SELECT text FROM social.comments WHERE id = $1`, [cid])).rows[0]!.text).toBe("-");
  });
});

describe("feed Cerca", () => {
  it("la posición de quien lee se redondea en el servidor", async () => {
    expect(roundNear(-12.046374)).toBe(-12.05);
    const a = (await t.app.inject({ url: "/v1/feed?tab=nearby&lat=-12.046374&lng=-77.042793", headers: auth(beto) })).json() as FeedResponse;
    const b = (await t.app.inject({ url: "/v1/feed?tab=nearby&lat=-12.05&lng=-77.04", headers: auth(beto) })).json() as FeedResponse;
    expect(a.posts.map((p) => [p.id, p.distanceBucket])).toEqual(b.posts.map((p) => [p.id, p.distanceBucket]));
  });
});
