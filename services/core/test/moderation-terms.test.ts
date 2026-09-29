import { compileTerms, type CaseSummary } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, type TestContext, type TestUser } from "./helpers.js";

// Listas de términos que envían a revisión (ADR 0148). Las listas reales están vacías; aquí se usa una de prueba.
let t: TestContext;
let mod: TestUser;
const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });

beforeAll(async () => {
  t = await createTestContext();
  const m = await createUser(t, "mod_terms");
  await t.c.identity.grantRole(m.userId, "moderator");
  mod = { ...m, token: (await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle: "mod_terms", platform: "ANDROID", deviceId: m.deviceId } })).json().token };
});
afterAll(() => t.close());

describe("listas de términos", () => {
  const queue = async () => (await t.app.inject({ url: "/v1/moderation/cases", headers: auth(mod) })).json().cases as CaseSummary[];

  it("con las listas vacías del repositorio no abre casos", async () => {
    const u = await createUser(t, "terms_a");
    const post = (await t.app.inject({ method: "POST", url: "/v1/posts", headers: auth(u), payload: { text: "Texto de prueba zzqx sin nada raro" } })).json().postId as string;
    await t.c.dispatcher.drain();
    expect((await queue()).some((c) => c.target.id === post)).toBe(false);
  });

  it("un término de la lista manda el post y el comentario a revisión sin ocultarlos", async () => {
    (t.c.social as unknown as { terms: unknown }).terms = compileTerms({ version: "test", languages: { es: [{ term: "zzqx", reason: "HARASSMENT" }] } });
    const u = await createUser(t, "terms_b");
    const post = (await t.app.inject({ method: "POST", url: "/v1/posts", headers: auth(u), payload: { text: "Otro texto con ZZQX dentro" } })).json().postId as string;
    const comment = (await t.app.inject({ method: "POST", url: `/v1/posts/${post}/comments`, headers: auth(u), payload: { text: "comentario zzqx" } })).json().id as string;
    await t.c.dispatcher.drain();
    const cases = await queue();
    expect(cases.some((c) => c.target.id === post)).toBe(true);
    expect(cases.some((c) => c.target.id === comment)).toBe(true);
    expect((await t.c.db.query<{ moderation_state: string }>(`SELECT moderation_state FROM social.posts WHERE id = $1`, [post])).rows[0]!.moderation_state).toBe("VISIBLE");
    const note = (await t.c.db.query<{ reason: string; note: string }>(`SELECT reason, note FROM moderation.flags WHERE target_id = $1`, [post])).rows[0]!;
    expect(note).toMatchObject({ reason: "HARASSMENT" });
    expect(note.note).toContain("zzqx");
  });
});
