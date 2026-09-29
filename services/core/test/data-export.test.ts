import type { DataExport } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, LIMA, offset, reportBody, submit, type TestContext } from "./helpers.js";

let t: TestContext;
beforeAll(async () => { t = await createTestContext(); });
afterAll(() => t.close());

describe("exportar mis datos (ADR 0038)", () => {
  it("incluye lo propio de cada módulo, sin secretos ni datos de otras personas", async () => {
    const [yo, otra] = await Promise.all([createUser(t, "exporta"), createUser(t, "ajena")]);
    const auth = { authorization: `Bearer ${yo.token}` };
    const rep = (await submit(t, yo, reportBody(yo, { category: "infra.water_outage", pin: offset(LIMA, 3000), text: "Sin agua desde ayer" }))).body;
    await t.app.inject({ method: "POST", url: "/v1/posts", headers: auth, payload: { text: "Mi post #Lima" } });
    await t.app.inject({ method: "POST", url: "/v1/posts", headers: { authorization: `Bearer ${otra.token}` }, payload: { text: "Post de otra persona" } });
    await t.app.inject({ method: "POST", url: "/v1/flags", headers: { authorization: `Bearer ${otra.token}` }, payload: { targetType: "POST", targetId: rep.postId, reason: "SPAM" } });
    await t.c.dispatcher.drain();

    expect((await t.app.inject({ url: "/v1/me/export" })).statusCode).toBe(401);
    const res = await t.app.inject({ url: "/v1/me/export", headers: auth });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="dizaster-export-\d{4}-\d{2}-\d{2}\.json"$/);
    const body = res.json() as DataExport;
    expect(body.format).toBe("dizaster-export-1");
    const s = body.sections;
    expect(s.identity["account"]![0]).toMatchObject({ id: yo.userId });
    expect(s.identity["devices"]).toHaveLength(1);
    expect(s.social["profile"]![0]).toMatchObject({ id: yo.profileId });
    expect((s.social["posts"] as { text: string | null }[]).map((p) => p.text).sort()).toEqual(["Mi post #Lima", "Sin agua desde ayer"]);
    expect(s.reports["reports"]![0]).toMatchObject({ id: rep.reportId, category_code: "infra.water_outage", presence_band: expect.any(String) });
    // Quién denunció mi contenido nunca sale; mis propias denuncias sí.
    expect(s.moderation["flagsISent"]).toEqual([]);

    const raw = res.body;
    expect(raw).not.toContain("Post de otra persona");
    expect(raw).not.toContain(otra.profileId);
    for (const secret of ["token_hash", "push_token\"", "score_breakdown", "low_trust", "storage_key"]) expect(raw).not.toContain(secret);

    expect((await t.app.inject({ url: "/v1/me/export", headers: auth })).statusCode).toBe(429);
  });
});
