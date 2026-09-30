import type { FeedResponse } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NEW_ACCOUNT_HOURS, RANK_BOOST_HOURS } from "../src/modules/social/index.js";
import { TRUST } from "../src/modules/trust/rules.js";
import { createTestContext, createUser, type TestContext, type TestUser } from "./helpers.js";

// Alcance limitado de cuentas nuevas en "Para ti" (§13.3, ADR 0220). NO AI REQUIRED.
let t: TestContext;
let nueva: TestUser;
let antigua: TestUser;
let lector: TestUser;
const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });
const post = async (u: TestUser, text: string) => (await t.app.inject({ method: "POST", url: "/v1/posts", headers: auth(u), payload: { text } })).json().postId as string;
const feed = async (tab: string) => ((await t.app.inject({ url: `/v1/feed?tab=${tab}`, headers: auth(lector) })).json() as FeedResponse).posts.map((p) => p.text);

beforeAll(async () => {
  t = await createTestContext();
  [nueva, antigua, lector] = [await createUser(t, "cuenta_nueva"), await createUser(t, "cuenta_antigua"), await createUser(t, "lector_alcance")];
  await t.c.db.query(`UPDATE social.profiles SET created_at = now() - interval '10 days' WHERE id = $1`, [antigua.profileId]);
});
afterAll(() => t.close());

describe("cuentas nuevas en Para ti", () => {
  it("usa la misma ventana que el nivel NEW de reputación y resta poco", () => {
    expect(NEW_ACCOUNT_HOURS).toBe(TRUST.newAccountHours);
    expect(RANK_BOOST_HOURS.newAccountAuthor).toBeLessThan(0);
    expect(RANK_BOOST_HOURS.newAccountAuthor).toBeGreaterThan(RANK_BOOST_HOURS.lowTrustAuthor);
  });

  it("a igual hora, el post de la cuenta nueva va detrás; lo que escribió después de su primer día, no", async () => {
    const nuevoId = await post(nueva, "Nuevo: corte de luz en Surco");
    await post(antigua, "Antigua: corte de luz en Surco");
    // Mismo instante para comparar solo la señal de alcance.
    await t.c.db.query(`UPDATE social.posts SET created_at = now() - interval '1 minute' WHERE author_id = ANY($1)`, [[nueva.profileId, antigua.profileId]]);
    expect(await feed("for_you")).toEqual(["Antigua: corte de luz en Surco", "Nuevo: corte de luz en Surco"]);

    // Una hora "después" de su primer día (la cuenta ya no es nueva al escribir): mismo peso que la antigua.
    await t.c.db.query(`UPDATE social.profiles SET created_at = now() - interval '2 days' WHERE id = $1`, [nueva.profileId]);
    await t.c.db.query(`UPDATE social.posts SET created_at = now() WHERE id = $1`, [nuevoId]);
    expect((await feed("for_you"))[0]).toBe("Nuevo: corte de luz en Surco");
  });
});
