import type { ModeratorEventDetail } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, reportBody, submit, type TestContext, type TestUser } from "./helpers.js";

// Subir la sensibilidad de un evento por su contexto (ADR 0179, Anexo A.5). NO AI REQUIRED.
let t: TestContext;
async function asModerator(handle: string): Promise<TestUser> {
  const u = await createUser(t, handle);
  await t.c.identity.grantRole(u.userId, "moderator");
  const token = (await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle, platform: "ANDROID", deviceId: u.deviceId } })).json().token as string;
  return { ...u, token };
}
beforeAll(async () => { t = await createTestContext(); });
afterAll(() => t.close());

const pub = async (id: string) => (await t.c.db.query<{ sensitivity: string; h3: string; lat: number; lng: number }>(
  `SELECT sensitivity, public_h3 AS h3, ST_Y(public_geom::geometry) AS lat, ST_X(public_geom::geometry) AS lng FROM event.events WHERE id = $1`, [id])).rows[0]!;
const postPoint = async (postId: string) => (await t.c.db.query<{ lat: number; lng: number }>(
  `SELECT ST_Y(public_point::geometry) AS lat, ST_X(public_point::geometry) AS lng FROM social.posts WHERE id = $1`, [postId])).rows[0]!;

describe("sensibilidad por contexto", () => {
  it("moderación la sube: el punto público y los posts de reportes pierden detalle; nunca baja", async () => {
    const reporter = await createUser(t, "sens_rep");
    const r = await submit(t, reporter, reportBody(reporter, { category: "accident.traffic" }));
    const eventId = r.body.eventId!;
    const before = await pub(eventId);
    const postBefore = await postPoint(r.body.postId!);
    expect(before.sensitivity).toBe("NORMAL");

    const mod = await asModerator("sens_mod");
    const url = `/v1/moderation/events/${eventId}/sensitivity`;
    const headers = { authorization: `Bearer ${mod.token}` };
    expect((await t.app.inject({ method: "POST", url, headers: { authorization: `Bearer ${reporter.token}` }, payload: { to: "SENSITIVE", reason: "albergue" } })).statusCode).toBe(403);

    const res = await t.app.inject({ method: "POST", url, headers, payload: { to: "HIGHLY_SENSITIVE", reason: "Incendio en un albergue" } });
    expect(res.statusCode).toBe(200);
    const d = res.json() as ModeratorEventDetail;
    expect(d.sensitivity).toBe("HIGHLY_SENSITIVE");
    expect(d.sensitivityChanges).toMatchObject([{ from: "NORMAL", to: "HIGHLY_SENSITIVE", reason: "Incendio en un albergue" }]);

    const after = await pub(eventId);
    expect(after.h3).not.toBe(before.h3);
    expect(after.lat !== before.lat || after.lng !== before.lng).toBe(true);

    await t.c.dispatcher.drain();
    const postAfter = await postPoint(r.body.postId!);
    expect(postAfter.lat !== postBefore.lat || postAfter.lng !== postBefore.lng).toBe(true);
    // Igual al punto del evento: ambos salen de la misma rejilla gruesa.
    expect(postAfter).toEqual({ lat: after.lat, lng: after.lng });

    const again = await t.app.inject({ method: "POST", url, headers, payload: { to: "SENSITIVE", reason: "bajar" } });
    expect(again.statusCode).toBe(409);
    expect((await t.app.inject({ method: "POST", url, headers, payload: { to: "NORMAL", reason: "bajar" } })).statusCode).toBe(400);
    await expect(t.c.db.query(`DELETE FROM event.sensitivity_log`)).rejects.toThrow(/solo se inserta/);
  });
});
