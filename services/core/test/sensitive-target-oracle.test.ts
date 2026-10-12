import { generalizationMarginM } from "@dizaster/geo-kit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, LIMA, reportBody, submit, type TestContext, type TestUser } from "./helpers.js";

/**
 * Elegir un evento sensible al reportar (ADR 0329): la distancia se mide contra su punto público y su margen, no contra
 * el preciso. Antes, aceptar o rechazar «demasiado lejos» permitía ubicar el punto preciso probando pines.
 */
let t: TestContext;
beforeAll(async () => { t = await createTestContext(); });
afterAll(() => t.close());

const R = 6_371_000;
/** Punto a `m` metros de `from`, en la dirección de `a` hacia `b` (o al norte si coinciden). */
function beyond(from: { lat: number; lng: number }, a: { lat: number; lng: number }, b: { lat: number; lng: number }, m: number) {
  const k = Math.cos((from.lat * Math.PI) / 180);
  let dy = b.lat - a.lat;
  let dx = (b.lng - a.lng) * k;
  const len = Math.hypot(dx, dy);
  if (len === 0) { dy = 1; dx = 0; } else { dy /= len; dx /= len; }
  const deg = (m / R) * (180 / Math.PI);
  return { lat: from.lat + dy * deg, lng: from.lng + (dx * deg) / k };
}

async function moderator(handle: string): Promise<TestUser> {
  const u = await createUser(t, handle);
  await t.c.identity.grantRole(u.userId, "moderator");
  return { ...u, token: (await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle, platform: "ANDROID", deviceId: u.deviceId } })).json().token as string };
}

describe("evento sensible elegido al reportar", () => {
  it("se acepta o rechaza según el punto público y su margen, nunca según el preciso", async () => {
    const reporter = await createUser(t, "oracle_rep");
    const created = await submit(t, reporter, reportBody(reporter, { category: "accident.traffic", pin: LIMA }));
    const eventId = created.body.eventId!;
    const mod = await moderator("oracle_mod");
    const raised = await t.app.inject({
      method: "POST", url: `/v1/moderation/events/${eventId}/sensitivity`, headers: { authorization: `Bearer ${mod.token}` },
      payload: { to: "HIGHLY_SENSITIVE", reason: "Ocurrió frente a un albergue" },
    });
    expect(raised.statusCode, raised.body).toBe(200);
    const geo = (await t.c.db.query<{ lat: number; lng: number; plat: number; plng: number }>(
      `SELECT ST_Y(geom::geometry) AS lat, ST_X(geom::geometry) AS lng, ST_Y(public_geom::geometry) AS plat, ST_X(public_geom::geometry) AS plng
         FROM event.events WHERE id = $1`, [eventId])).rows[0]!;
    const precise = { lat: geo.lat, lng: geo.lng };
    const pub = { lat: geo.plat, lng: geo.plng };
    const category = t.c.ref.category("accident.traffic", "PE")!;
    const reach = Math.max(category.dedupRadiusM * 1.5, category.presenceRadiusM) + generalizationMarginM("HIGHLY_SENSITIVE");

    const counter = async (handle: string, pin: { lat: number; lng: number }) => {
      const u = await createUser(t, handle);
      return submit(t, u, reportBody(u, { category: "accident.traffic", pin, assertion: "NOT_OCCURRING", targetEventId: eventId }));
    };
    // Cerca del punto público pero lejos del preciso (antes: «demasiado lejos»).
    const near = await counter("oracle_near", beyond(pub, precise, pub, reach - 50));
    expect(near.body, JSON.stringify(near.body)).toMatchObject({ outcome: "ATTACHED_TO_EVENT", eventId });
    // Más allá del margen del punto público, aunque más cerca del preciso que antes: se rechaza.
    const far = await counter("oracle_far", beyond(pub, pub, precise, reach + 50));
    expect(far.status).toBe(422);
    expect(far.body).toMatchObject({ error: "INVALID_TARGET" });
  });
});
