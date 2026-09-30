import type { CaseSummary } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, type TestContext, type TestUser } from "./helpers.js";

// Personal suspendido sin poderes y conflicto de interés (ADR 0214).
let t: TestContext;
const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });

async function asModerator(handle: string): Promise<TestUser> {
  const u = await createUser(t, handle);
  await t.c.identity.grantRole(u.userId, "moderator");
  const token = (await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle, platform: "ANDROID", deviceId: u.deviceId } })).json().token as string;
  return { ...u, token };
}
async function caseFor(mod: TestUser, postId: string, flagger: TestUser): Promise<string> {
  await t.app.inject({ method: "POST", url: "/v1/flags", headers: auth(flagger), payload: { targetType: "POST", targetId: postId, reason: "OTHER", note: "revisar esto" } });
  const cases = (await t.app.inject({ url: "/v1/moderation/cases", headers: auth(mod) })).json().cases as CaseSummary[];
  return cases.find((c) => c.target.id === postId)!.id;
}

beforeAll(async () => { t = await createTestContext(); });
afterAll(() => t.close());

describe("conflicto de interés y personal suspendido", () => {
  it("nadie modera su propio contenido", async () => {
    const [mod, other, flagger] = [await asModerator("mod_propio"), await asModerator("mod_ajeno"), await createUser(t, "denuncia_propio")];
    const postId = (await t.app.inject({ method: "POST", url: "/v1/posts", headers: auth(mod), payload: { text: "Mi propio post" } })).json().postId as string;
    const caseId = await caseFor(mod, postId, flagger);
    const own = await t.app.inject({ method: "POST", url: `/v1/moderation/cases/${caseId}/actions`, headers: auth(mod), payload: { action: "DISMISS", reason: "Lo reviso yo mismo" } });
    expect(own.statusCode).toBe(409);
    expect(own.json().error).toBe("CONFLICT_OF_INTEREST");
    const fair = await t.app.inject({ method: "POST", url: `/v1/moderation/cases/${caseId}/actions`, headers: auth(other), payload: { action: "DISMISS", reason: "No infringe las normas" } });
    expect(fair.statusCode).toBe(200);
  });

  it("un moderador suspendido pierde sus permisos y los recupera al reactivarse", async () => {
    const mod = await asModerator("mod_suspendido");
    expect((await t.app.inject({ url: "/v1/moderation/cases", headers: auth(mod) })).statusCode).toBe(200);
    await t.c.identity.setUserStatus(t.c.db, mod.userId, "SUSPENDED");
    expect((await t.app.inject({ url: "/v1/moderation/cases", headers: auth(mod) })).statusCode).toBe(403);
    await t.c.identity.setUserStatus(t.c.db, mod.userId, "ACTIVE");
    expect((await t.app.inject({ url: "/v1/moderation/cases", headers: auth(mod) })).statusCode).toBe(200);
  });
});
