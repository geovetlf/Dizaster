import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, LIMA, offset, reportBody, submit, type TestContext, type TestUser } from "./helpers.js";

let t: TestContext;
const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });

async function asModerator(handle: string): Promise<TestUser> {
  const u = await createUser(t, handle);
  await t.c.identity.grantRole(u.userId, "moderator");
  const token = (await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle, platform: "ANDROID", deviceId: u.deviceId } })).json().token as string;
  return { ...u, token };
}
const follow = (u: TestUser, id: string) => t.app.inject({ method: "PUT", url: `/v1/follows/event/${id}`, headers: auth(u) });
const followed = async (u: TestUser) =>
  (await t.c.db.query<{ target_id: string }>(`SELECT target_id FROM social.follows WHERE follower_profile_id = $1 AND target_type = 'EVENT' ORDER BY target_id`, [u.profileId]))
    .rows.map((r) => r.target_id);

beforeAll(async () => { t = await createTestContext(); });
afterAll(() => t.close());

describe("seguidores de un EVENT fusionado (ADR 0093)", () => {
  it("pasan al destino al fusionar y vuelven a quedar como estaban al revertir", async () => {
    const mod = await asModerator("mod_seguidores");
    const [r1, r2, soloB, ambos, manual] = await Promise.all(["rep_a", "rep_b", "sigue_b", "sigue_ambos", "sigue_manual"].map((h) => createUser(t, h)));
    const A = (await submit(t, r1!, reportBody(r1!, { category: "fire.structure", pin: LIMA }))).body.eventId!;
    const B = (await submit(t, r2!, reportBody(r2!, { category: "fire.structure", pin: offset(LIMA, 20_000) }))).body.eventId!;
    await t.c.dispatcher.drain();
    expect(B).not.toBe(A);
    for (const u of [soloB!, ambos!, manual!]) expect((await follow(u, B)).statusCode).toBe(200);
    await follow(ambos!, A);

    const merge = await t.app.inject({ method: "POST", url: `/v1/moderation/events/${A}/merge`, headers: auth(mod), payload: { sourceEventIds: [B], reason: "Es el mismo incendio" } });
    expect(merge.statusCode, merge.body).toBe(200);
    await t.c.dispatcher.drain();
    expect(await followed(soloB!)).toEqual([A, B].sort());
    expect(await followed(ambos!)).toEqual([A, B].sort());
    // Los avisos del destino llegan a quien seguía el duplicado.
    const followers = await t.c.social.followersOf(t.c.db, { eventId: A, placeIds: [] });
    expect(followers.map((f) => f.profileId)).toEqual(expect.arrayContaining([soloB!.profileId, ambos!.profileId, manual!.profileId]));

    // Seguir el destino a mano después de la fusión lo conserva aunque se revierta.
    await follow(manual!, A);

    const mergeId = (merge.json() as { mergeIds: string[] }).mergeIds[0]!;
    const revert = await t.app.inject({ method: "POST", url: `/v1/moderation/merges/${mergeId}/revert`, headers: auth(mod), payload: { reason: "Eran dos incendios distintos" } });
    expect(revert.statusCode, revert.body).toBe(200);
    await t.c.dispatcher.drain();
    expect(await followed(soloB!)).toEqual([B]);
    expect(await followed(ambos!)).toEqual([A, B].sort());
    expect(await followed(manual!)).toEqual([A, B].sort());
  });
});
