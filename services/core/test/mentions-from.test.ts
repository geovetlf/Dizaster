import type { FeedPost, MyProfile } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, type TestContext, type TestUser } from "./helpers.js";

let t: TestContext;
let rosa: TestUser;
let amiga: TestUser;
let extrana: TestUser;
let handle: string;
const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });
const mention = async (u: TestUser) => {
  const id = (await t.app.inject({ method: "POST", url: "/v1/posts", headers: auth(u), payload: { text: `Hola @${handle}` } })).json().postId as string;
  return ((await t.app.inject({ url: `/v1/posts/${id}`, headers: auth(u) })).json() as FeedPost).mentions;
};
const setMentions = (v: string) => t.app.inject({ method: "PATCH", url: "/v1/me", headers: auth(rosa), payload: { mentionsFrom: v } });

beforeAll(async () => {
  t = await createTestContext();
  rosa = await createUser(t, "rosa_menciones");
  amiga = await createUser(t, "amiga_menciones");
  extrana = await createUser(t, "extrana_menciones");
  handle = (await t.c.db.query<{ handle: string }>(`SELECT handle FROM social.profiles WHERE id = $1`, [rosa.profileId])).rows[0]!.handle;
  await t.c.social.setFollow(t.c.db, rosa.profileId, "PROFILE", amiga.profileId, true);
});
afterAll(() => t.close());

describe("quién puede mencionarte (ADR 0137)", () => {
  it("por defecto todos; se ajusta desde mi perfil", async () => {
    const me = (await t.app.inject({ url: "/v1/me", headers: auth(rosa) })).json() as MyProfile;
    expect(me.mentionsFrom).toBe("EVERYONE");
    expect(await mention(extrana)).toEqual([handle]);
    expect((await setMentions("FOLLOWING")).json()).toMatchObject({ mentionsFrom: "FOLLOWING" });
    expect((await setMentions("ALGUNOS")).statusCode).toBe(400);
  });

  it("solo quienes sigo: la mención de otra persona queda como texto y no avisa", async () => {
    await setMentions("FOLLOWING");
    expect(await mention(amiga)).toEqual([handle]);
    expect(await mention(extrana)).toEqual([]);
  });

  it("nadie", async () => {
    await setMentions("NOBODY");
    expect(await mention(amiga)).toEqual([]);
  });
});
