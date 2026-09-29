import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, type TestContext, type TestUser } from "./helpers.js";

// Datos personales en publicaciones y comentarios → cola de moderación (ADR 0088, §13.3). NO AI REQUIRED.
let t: TestContext;
beforeAll(async () => { t = await createTestContext(); });
afterAll(async () => { await t.close(); });

const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });
const post = async (u: TestUser, payload: object) => {
  const res = await t.app.inject({ method: "POST", url: "/v1/posts", headers: auth(u), payload });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().postId as string;
};
const flags = async (targetId: string) => {
  await t.c.dispatcher.drain();
  return (await t.c.db.query<{ reason: string; note: string }>(
    `SELECT f.reason, f.note FROM moderation.flags f JOIN moderation.cases c ON c.id = f.case_id WHERE f.target_id = $1 AND c.status = 'OPEN'`, [targetId],
  )).rows;
};

describe("datos personales", () => {
  it("un post con teléfono y documento entra en la cola como PRIVACY, con los tipos y sin el dato", async () => {
    const u = await createUser(t, "doxx_1");
    const id = await post(u, { text: "Este es el que robó, su DNI 45678912 y su cel 987 654 321" });
    const f = await flags(id);
    expect(f).toHaveLength(1);
    expect(f[0]!.reason).toBe("PRIVACY");
    expect(f[0]!.note).toContain("ID_DOCUMENT");
    expect(f[0]!.note).toContain("PHONE");
    expect(f[0]!.note).not.toMatch(/4567|987/);
    // Nada se oculta solo.
    expect((await t.app.inject({ url: `/v1/posts/${id}` })).statusCode).toBe(200);
  });

  it("también en comentarios; un texto normal no", async () => {
    const u = await createUser(t, "doxx_2");
    const id = await post(u, { text: "Se fue la luz en todo el barrio desde las 14:05" });
    expect(await flags(id)).toEqual([]);
    const c = await t.app.inject({ method: "POST", url: `/v1/posts/${id}/comments`, headers: auth(u), payload: { text: "escríbanle a vecina.ana@correo.pe" } });
    expect(c.statusCode, c.body).toBe(201);
    const f = await flags(c.json().id);
    expect(f.map((x) => x.reason)).toEqual(["PRIVACY"]);
  });

  it("un negocio puede publicar su teléfono; una tarjeta sí va a revisión", async () => {
    const owner = await createUser(t, "doxx_negocio");
    const b = await t.app.inject({ method: "POST", url: "/v1/businesses", headers: auth(owner), payload: { handle: "bodega_luz", name: "Bodega Luz", category: "grocery", country: "PE" } });
    expect(b.statusCode, b.body).toBe(201);
    expect(await flags(await post(owner, { text: "Pedidos al 987 654 321 o bodega@luz.pe", asBusiness: "bodega_luz" }))).toEqual([]);
    const card = await post(owner, { text: "Donaciones a la tarjeta 4111 1111 1111 1111", asBusiness: "bodega_luz" });
    expect((await flags(card)).map((x) => x.reason)).toEqual(["PRIVACY"]);
  });
});
