import type { ModerationActionsResponse } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId } from "../src/platform/ids.js";
import { createTestContext, createUser, type TestContext, type TestUser } from "./helpers.js";

describe("registro de acciones por moderador (ADR 0239)", () => {
  let t: TestContext;
  let admin: string;
  let modA: TestUser;
  let modB: TestUser;
  let target: TestUser;
  const get = async (q: string) => (await t.app.inject({ url: `/v1/admin/moderation-actions${q}`, headers: { authorization: `Bearer ${admin}` } }));
  beforeAll(async () => {
    t = await createTestContext();
    const a = await createUser(t, "admin_registro");
    await t.c.identity.grantRole(a.userId, "admin");
    admin = (await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle: "admin_registro", platform: "ANDROID", deviceId: a.deviceId } })).json().token as string;
    modA = await createUser(t, "moderadora_a");
    modB = await createUser(t, "moderador_b");
    target = await createUser(t, "afectado_log");
    const insert = (mod: TestUser | null) => t.c.db.query(
      `INSERT INTO moderation.actions (id, target_type, target_id, affected_user_id, action, actor, moderator_user_id, reason)
       VALUES ($1, 'PROFILE', $2, $3, 'LIMIT', $4, $5, 'Motivo de prueba')`,
      [newId(), target.profileId, target.userId, mod ? "MODERATOR" : "RULE", mod?.userId ?? null],
    );
    for (const m of [modA, modB, modA, null, modA]) await insert(m);
  });
  afterAll(async () => { await t.close(); });

  it("muestra quién moderó cada acción, filtra por moderador y pagina", async () => {
    const handle = async (u: TestUser) => (await t.c.db.query<{ handle: string }>(`SELECT handle FROM social.profiles WHERE id = $1`, [u.profileId])).rows[0]!.handle;
    const ha = await handle(modA);
    const hb = await handle(modB);
    const all = (await get("")).json() as ModerationActionsResponse;
    expect(all.actions.map((a) => a.moderatorHandle)).toEqual([ha, null, ha, hb, ha]);
    const page1 = (await get(`?moderator=@${ha}&limit=2`)).json() as ModerationActionsResponse;
    expect(page1.actions).toHaveLength(2);
    const page2 = (await get(`?moderator=${ha}&limit=2&cursor=${page1.nextCursor}`)).json() as ModerationActionsResponse;
    expect(page2.actions).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();
    expect([...page1.actions, ...page2.actions].every((a) => a.moderatorHandle === ha)).toBe(true);
  });

  it("solo administración", async () => {
    expect((await t.app.inject({ url: "/v1/admin/moderation-actions", headers: { authorization: `Bearer ${modA.token}` } })).statusCode).toBe(403);
  });
});
