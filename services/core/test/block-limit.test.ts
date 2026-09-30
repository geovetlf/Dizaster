import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_BLOCKS } from "../src/modules/social/index.js";
import { createTestContext, createUser, type TestContext, type TestUser } from "./helpers.js";

// Tope de bloqueos (ADR 0208): la lista y el filtro del feed quedan acotados.
let t: TestContext;
beforeAll(async () => { t = await createTestContext(); });
afterAll(() => t.close());

const handleOf = async (u: TestUser) =>
  (await t.c.db.query<{ handle: string }>(`SELECT handle FROM social.profiles WHERE id = $1`, [u.profileId])).rows[0]!.handle;

describe("tope de bloqueos", () => {
  it("con el tope alcanzado no se bloquea a nadie nuevo, pero re-bloquear y desbloquear funcionan", async () => {
    const [me, fresh, old] = [await createUser(t, "bloquea_mucho"), await createUser(t, "bloqueada_nueva"), await createUser(t, "bloqueada_antes")];
    const auth = { authorization: `Bearer ${me.token}` };
    const block = async (u: TestUser, method: "PUT" | "DELETE") => t.app.inject({ method, url: `/v1/blocks/${await handleOf(u)}`, headers: auth });
    expect((await block(old, "PUT")).statusCode).toBe(200);
    // Rellenar hasta el tope: solo cuenta el número de filas, así que valen ids sin perfil (sin comprobar la FK).
    await t.c.db.query(`ALTER TABLE social.blocks DISABLE TRIGGER ALL`);
    await t.c.db.query(
      `INSERT INTO social.blocks (blocker_profile_id, blocked_profile_id) SELECT $1, gen_random_uuid() FROM generate_series(1, $2)`,
      [me.profileId, MAX_BLOCKS - 1],
    );
    await t.c.db.query(`ALTER TABLE social.blocks ENABLE TRIGGER ALL`);

    const res = await block(fresh, "PUT");
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("LIMIT_REACHED");
    expect((await block(old, "PUT")).statusCode).toBe(200);
    expect((await block(old, "DELETE")).statusCode).toBe(200);
    expect((await block(fresh, "PUT")).statusCode).toBe(200);
    expect(((await t.app.inject({ url: "/v1/me/blocks", headers: auth })).json().handles as string[])).toContain(await handleOf(fresh));
  });
});
