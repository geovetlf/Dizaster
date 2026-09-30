import type { FeedResponse } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FOLLOWING_WINDOW_DAYS } from "../src/modules/social/index.js";
import { createTestContext, createUser, type TestContext, type TestUser } from "./helpers.js";

// Feed "Siguiendo" acotado e indexable (ADR 0226). NO AI REQUIRED.
let t: TestContext;
let autora: TestUser;
let lectora: TestUser;
const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });

beforeAll(async () => {
  t = await createTestContext();
  autora = await createUser(t, "autora_seguida");
  lectora = await createUser(t, "lectora_sigue");
  const handle = (await t.c.db.query<{ handle: string }>(`SELECT handle FROM social.profiles WHERE id = $1`, [autora.profileId])).rows[0]!.handle;
  expect((await t.app.inject({ method: "PUT", url: `/v1/follows/profile/${handle}`, headers: auth(lectora) })).statusCode).toBe(200);
});
afterAll(() => t.close());

describe("Siguiendo", () => {
  it(`muestra lo de los últimos ${FOLLOWING_WINDOW_DAYS} días de quien sigo`, async () => {
    for (const text of ["Reciente", "Antiguo"]) await t.app.inject({ method: "POST", url: "/v1/posts", headers: auth(autora), payload: { text } });
    await t.c.db.query(`UPDATE social.posts SET created_at = now() - make_interval(days => $2) WHERE author_id = $1 AND text = 'Antiguo'`, [autora.profileId, FOLLOWING_WINDOW_DAYS + 1]);
    const feed = (await t.app.inject({ url: "/v1/feed?tab=following", headers: auth(lectora) })).json() as FeedResponse;
    expect(feed.posts.map((p) => p.text)).toEqual(["Reciente"]);
  });
});
