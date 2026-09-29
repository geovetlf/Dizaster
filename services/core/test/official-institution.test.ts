import type { BusinessView, EventSourceView, VerificationView } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, LIMA, reportBody, submit, type TestContext, type TestUser } from "./helpers.js";

let t: TestContext;
let admin: TestUser;
let owner: TestUser;
const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });

async function withRole(handle: string, role: "admin" | "moderator"): Promise<TestUser> {
  const u = await createUser(t, handle);
  await t.c.identity.grantRole(u.userId, role);
  const token = (await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle, platform: "ANDROID", deviceId: u.deviceId } })).json().token as string;
  return { ...u, token };
}
const state = async (eventId: string) => (await t.app.inject({ url: `/v1/events/${eventId}/verification` })).json() as VerificationView;
const setVerification = (handle: string, verification: string) =>
  t.app.inject({ method: "PUT", url: `/v1/admin/businesses/${handle}/verification`, headers: auth(admin), payload: { verification } });
const setScope = (handle: string, payload: Record<string, unknown>, who = admin) =>
  t.app.inject({ method: "PUT", url: `/v1/admin/businesses/${handle}/official-scope`, headers: auth(who), payload });
const declare = (u: TestUser, handle: string, eventId: string, assertion = "OCCURRING") =>
  t.app.inject({ method: "POST", url: `/v1/businesses/${handle}/official-statements`, headers: auth(u), payload: { eventId, assertion } });
async function fireEvent(handle: string, pin = LIMA): Promise<string> {
  const u = await createUser(t, handle);
  const r = (await submit(t, u, reportBody(u, { category: "fire.structure", pin }))).body;
  await t.c.dispatcher.drain();
  return r.eventId!;
}

beforeAll(async () => {
  t = await createTestContext();
  admin = await withRole("admin_inst", "admin");
  owner = await createUser(t, "bomberos_admin");
  const res = await t.app.inject({ method: "POST", url: "/v1/businesses", headers: auth(owner), payload: { handle: "bomberos_pe", name: "Cuerpo de Bomberos", category: "services", country: "PE" } });
  expect(res.statusCode, res.body).toBe(201);
});
afterAll(() => t.close());

describe("perfil institucional oficial como fuente OFICIAL (ADR 0095)", () => {
  it("el ámbito exige el sello institucional, categorías y países reales, y solo lo fija administración", async () => {
    expect((await setScope("bomberos_pe", { categories: ["fire"], countries: ["PE"] })).statusCode).toBe(409);
    expect((await setVerification("bomberos_pe", "INSTITUTIONAL_OFFICIAL")).statusCode).toBe(200);
    expect((await setScope("bomberos_pe", { categories: ["fire"], countries: ["PE"] }, owner)).statusCode).toBe(403);
    expect((await setScope("bomberos_pe", { categories: ["no.existe"], countries: ["PE"] })).statusCode).toBe(400);
    expect((await setScope("bomberos_pe", { categories: ["fire"], countries: ["ZZ"] })).statusCode).toBe(400);
    const ok = await setScope("bomberos_pe", { categories: ["fire", "fire"], countries: ["PE"] });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toEqual({ categories: ["fire"], countries: ["PE"], active: true });
    expect((await t.app.inject({ url: "/v1/businesses/bomberos_pe/official-scope" })).json()).toEqual({ scope: { categories: ["fire"], countries: ["PE"], active: true } });
  });

  it("una confirmación explícita de quien lo administra lleva el evento a OFFICIALLY_CONFIRMED", async () => {
    const eventId = await fireEvent("vecino_incendio");
    expect((await state(eventId)).level).toBe("UNVERIFIED");
    const intruder = await createUser(t, "intruso_inst");
    expect((await declare(intruder, "bomberos_pe", eventId)).statusCode).toBe(404);

    const res = await declare(owner, "bomberos_pe", eventId);
    expect(res.statusCode, res.body).toBe(200);
    await t.c.dispatcher.drain();
    const v = await state(eventId);
    expect(v.level).toBe("OFFICIALLY_CONFIRMED");
    expect(JSON.stringify(v.explanation)).toContain("Cuerpo de Bomberos");
    const sources = (await t.app.inject({ url: `/v1/events/${eventId}/sources` })).json() as { sources: EventSourceView[] };
    expect(sources.sources.map((s) => s.sourceName)).toContain("Cuerpo de Bomberos");
    // Repetir es idempotente; desmentir después no se permite.
    expect((await declare(owner, "bomberos_pe", eventId)).statusCode).toBe(200);
    expect((await declare(owner, "bomberos_pe", eventId, "NOT_OCCURRING")).statusCode).toBe(409);
    expect((await t.c.db.query(`SELECT 1 FROM event.evidence WHERE event_id = $1 AND trust_tier = 'OFFICIAL'`, [eventId])).rowCount).toBe(1);
  });

  it("un desmentido marca FALSE; fuera del ámbito se rechaza", async () => {
    const eventId = await fireEvent("vecina_humo", { lat: -12.1, lng: -77.03 });
    const res = await declare(owner, "bomberos_pe", eventId, "NOT_OCCURRING");
    expect(res.statusCode, res.body).toBe(200);
    await t.c.dispatcher.drain();
    expect((await state(eventId)).negativeState).toBe("FALSE");

    const u = await createUser(t, "choque_inst");
    const crash = (await submit(t, u, reportBody(u, { category: "accident.traffic", pin: { lat: -12.2, lng: -77.0 } }))).body.eventId!;
    expect((await declare(owner, "bomberos_pe", crash)).statusCode).toBe(403);
  });

  it("al perder el sello deja de poder declarar", async () => {
    const eventId = await fireEvent("vecino_tarde", { lat: -12.05, lng: -76.95 });
    expect((await setVerification("bomberos_pe", "VERIFIED")).statusCode).toBe(200);
    expect((await declare(owner, "bomberos_pe", eventId)).statusCode).toBe(403);
    expect(((await t.app.inject({ url: "/v1/businesses/bomberos_pe/official-scope" })).json() as { scope: unknown }).scope).toBeNull();
    // Volver a darle el sello no reactiva nada solo: administración debe fijar el ámbito otra vez.
    await setVerification("bomberos_pe", "INSTITUTIONAL_OFFICIAL");
    expect((await declare(owner, "bomberos_pe", eventId)).statusCode).toBe(403);
    const b = (await t.app.inject({ url: "/v1/businesses/bomberos_pe" })).json() as BusinessView;
    expect(b.verification).toBe("INSTITUTIONAL_OFFICIAL");
  });
});
