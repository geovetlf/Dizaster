import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_BLOCKS } from "../src/modules/social/index.js";
import { createTestContext, createUser, type TestContext, type TestUser } from "./helpers.js";

// Cupos sin carrera (ADR 0268): envíos simultáneos no superan juntos el cupo de comentarios ni el tope de bloqueos.
let t: TestContext;
const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });
beforeAll(async () => { t = await createTestContext(); });
afterAll(() => t.close());

const handleOf = async (u: TestUser) =>
  (await t.c.db.query<{ handle: string }>(`SELECT handle FROM social.profiles WHERE id = $1`, [u.profileId])).rows[0]!.handle;

describe("comentarios y bloqueos simultáneos", () => {
  it("el cupo por minuto se respeta aunque los comentarios lleguen a la vez", async () => {
    const autor = await createUser(t, "conc_autor");
    const post = (await t.app.inject({ method: "POST", url: "/v1/posts", headers: auth(autor), payload: { text: "Post" } })).json().postId as string;
    const { commentsPerMinute } = await t.c.trust.socialLimits(t.c.db, autor.userId);
    const res = await Promise.all(Array.from({ length: commentsPerMinute + 5 }, (_, i) =>
      t.app.inject({ method: "POST", url: `/v1/posts/${post}/comments`, headers: auth(autor), payload: { text: `c${i}` } })));
    expect(res.filter((r) => r.statusCode === 201)).toHaveLength(commentsPerMinute);
    expect(res.filter((r) => r.statusCode === 429)).toHaveLength(5);
    const n = (await t.c.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM social.comments WHERE author_profile_id = $1`, [autor.profileId])).rows[0]!.n;
    expect(n).toBe(commentsPerMinute);
  });

  it("el mismo id de cliente enviado dos veces a la vez crea un solo comentario", async () => {
    const autor = await createUser(t, "conc_reintento");
    const post = (await t.app.inject({ method: "POST", url: "/v1/posts", headers: auth(autor), payload: { text: "Post" } })).json().postId as string;
    const clientId = "0b8f6a8e-6f0e-4f3e-9d57-8a0b6a0f0c01";
    const res = await Promise.all([0, 1, 2].map(() =>
      t.app.inject({ method: "POST", url: `/v1/posts/${post}/comments`, headers: auth(autor), payload: { text: "hola", clientId } })));
    expect(res.map((r) => r.statusCode)).toEqual([201, 201, 201]);
    expect(new Set(res.map((r) => r.json().id)).size).toBe(1);
  });

  it("con un solo hueco en el tope, de dos bloqueos simultáneos pasa uno", async () => {
    const [me, a, b] = [await createUser(t, "conc_bloquea"), await createUser(t, "conc_blq_a"), await createUser(t, "conc_blq_b")];
    await t.c.db.query(`ALTER TABLE social.blocks DISABLE TRIGGER ALL`);
    await t.c.db.query(
      `INSERT INTO social.blocks (blocker_profile_id, blocked_profile_id) SELECT $1, gen_random_uuid() FROM generate_series(1, $2)`,
      [me.profileId, MAX_BLOCKS - 1],
    );
    await t.c.db.query(`ALTER TABLE social.blocks ENABLE TRIGGER ALL`);
    const res = await Promise.all([a, b].map(async (u) => t.app.inject({ method: "PUT", url: `/v1/blocks/${await handleOf(u)}`, headers: auth(me) })));
    expect(res.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const n = (await t.c.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM social.blocks WHERE blocker_profile_id = $1`, [me.profileId])).rows[0]!.n;
    expect(n).toBe(MAX_BLOCKS);
  });
});
