import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId } from "../src/platform/ids.js";
import { createTestContext, createUser, type TestContext, type TestUser } from "./helpers.js";

describe("apelaciones paginadas y por id (ADR 0236)", () => {
  let t: TestContext;
  let autor: TestUser;
  let mod: TestUser;
  const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });
  beforeAll(async () => {
    t = await createTestContext();
    autor = await createUser(t, "apela_muchas");
    mod = await createUser(t, "mod_paginas");
    await t.c.identity.grantRole(mod.userId, "moderator");
    mod = { ...mod, token: (await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle: "mod_paginas", platform: "ANDROID", deviceId: mod.deviceId } })).json().token as string };
  });
  afterAll(async () => { await t.close(); });

  /** Una acción de moderación sobre el perfil del autor, creada `ageMin` minutos atrás. */
  async function action(ageMin: number): Promise<string> {
    const id = newId();
    await t.c.db.query(
      `INSERT INTO moderation.actions (id, target_type, target_id, affected_user_id, action, actor, reason, created_at)
       VALUES ($1, 'PROFILE', $2, $3, 'LIMIT', 'RULE', 'Muchas denuncias', now() - make_interval(mins => $4))`,
      [id, autor.profileId, autor.userId, ageMin],
    );
    return id;
  }

  it("se puede apelar una acción aunque no esté entre las 50 más recientes", async () => {
    const old = await action(60 * 24);
    for (let i = 0; i < 52; i++) await action(i);
    const res = await t.app.inject({ method: "POST", url: `/v1/me/moderation/${old}/appeal`, headers: auth(autor), payload: { text: "Apelo esta acción de ayer" } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ action: { id: old }, appeal: { status: "OPEN" } });
  });

  it("la lista se pagina con cursor sin repetir ni perder apelaciones", async () => {
    const ids = await t.c.db.query<{ id: string }>(`SELECT id FROM moderation.actions WHERE affected_user_id = $1 AND NOT EXISTS (SELECT 1 FROM moderation.appeals ap WHERE ap.action_id = moderation.actions.id) LIMIT 4`, [autor.userId]);
    for (const r of ids.rows) {
      expect((await t.app.inject({ method: "POST", url: `/v1/me/moderation/${r.id}/appeal`, headers: auth(autor), payload: { text: "Otra apelación de prueba" } })).statusCode).toBe(201);
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = (await t.app.inject({ url: `/v1/moderation/appeals?limit=2${cursor ? `&cursor=${cursor}` : ""}`, headers: auth(mod) })).json() as { appeals: Array<{ id: string }>; nextCursor: string | null };
      expect(page.appeals.length).toBeLessThanOrEqual(2);
      seen.push(...page.appeals.map((a) => a.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    expect([...seen].sort()).toEqual(seen); // abiertas: las más antiguas primero
  });
});
