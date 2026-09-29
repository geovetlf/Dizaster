import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SOCIAL_LIMITS } from "../src/modules/trust/index.js";
import { createTestContext, createUser, LIMA, offset, reportBody, submit, type TestContext, type TestUser } from "./helpers.js";

let t: TestContext;
beforeAll(async () => { t = await createTestContext(); });
afterAll(() => t.close());

const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });
const post = (u: TestUser, i: number) => t.app.inject({ method: "POST", url: "/v1/posts", headers: auth(u), payload: { text: `Publicación ${i}` } });

describe("límites por nivel de confianza (ADR 0132)", () => {
  it("una cuenta nueva publica la mitad por hora que una establecida", async () => {
    const fresh = await createUser(t, "limite_nueva", 2);
    for (let i = 0; i < SOCIAL_LIMITS.NEW.postsPerHour; i++) expect((await post(fresh, i)).statusCode).toBe(201);
    expect((await post(fresh, 99)).statusCode).toBe(429);
    const settled = await createUser(t, "limite_establecida");
    for (let i = 0; i < SOCIAL_LIMITS.NEW.postsPerHour + 1; i++) expect((await post(settled, i)).statusCode).toBe(201);
  });

  it("una cuenta nueva comenta menos por minuto", async () => {
    const author = await createUser(t, "limite_autor");
    const postId = (await post(author, 0)).json().postId as string;
    const fresh = await createUser(t, "limite_comenta", 2);
    const comment = (i: number) => t.app.inject({ method: "POST", url: `/v1/posts/${postId}/comments`, headers: auth(fresh), payload: { text: `Comentario ${i}` } });
    for (let i = 0; i < SOCIAL_LIMITS.NEW.commentsPerMinute; i++) expect((await comment(i)).statusCode).toBe(201);
    expect((await comment(99)).statusCode).toBe(429);
  });

  it("tope diario de reportes: 4 veces el cupo por hora", async () => {
    const u = await createUser(t, "limite_diario");
    // 20 reportes (4 × 5) repartidos en las últimas 24 h, ninguno en la última hora.
    for (let i = 0; i < 20; i++) {
      expect((await submit(t, u, reportBody(u, { pin: offset(LIMA, 50_000 + i * 3000) }))).status).toBe(200);
      if (i % 4 === 3) await t.c.db.query(`UPDATE report.reports SET received_at = now() - interval '3 hours' WHERE author_user_id = $1`, [u.userId]);
    }
    await t.c.db.query(`UPDATE report.reports SET received_at = now() - interval '3 hours' WHERE author_user_id = $1`, [u.userId]);
    const r = await submit(t, u, reportBody(u, { pin: offset(LIMA, 200_000) }));
    expect(r.status).toBe(429);
    await t.c.db.query(`UPDATE report.reports SET received_at = now() - interval '25 hours' WHERE author_user_id = $1`, [u.userId]);
    expect((await submit(t, u, reportBody(u, { pin: offset(LIMA, 210_000) }))).status).toBe(200);
  });
});
