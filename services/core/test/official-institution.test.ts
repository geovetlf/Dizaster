import type { BusinessView, EventSourceView, VerificationView } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTransaction } from "../src/platform/db.js";
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

describe("declaraciones y fusiones (ADR 0149)", () => {
  it("tras fusionar, la institución no puede desmentir el evento que ya confirmó", async () => {
    await setVerification("bomberos_pe", "INSTITUTIONAL_OFFICIAL");
    await setScope("bomberos_pe", { categories: ["fire"], countries: ["PE"] });
    const a = await fireEvent("vecino_fusion_a", { lat: -12.3, lng: -76.8 });
    const b = await fireEvent("vecino_fusion_b", { lat: -12.4, lng: -76.7 });
    expect(a).not.toBe(b);
    expect((await declare(owner, "bomberos_pe", a)).statusCode).toBe(200);
    await t.c.dispatcher.drain();
    await withTransaction(t.c.db, (tx) => t.c.events.merge(tx, b, a, "test", "mismo incendio"));
    await t.c.dispatcher.drain();
    const items = await t.c.db.query<{ event_id: string }>(`SELECT i.event_id FROM ingestion.external_items i JOIN ingestion.sources s ON s.id = i.source_id WHERE s.key LIKE 'institution:%' AND i.external_id LIKE $1`, [`${a}:%`]);
    expect(items.rows.map((r) => r.event_id)).toEqual([b]);
    expect((await declare(owner, "bomberos_pe", b, "NOT_OCCURRING")).statusCode).toBe(409);
    expect((await declare(owner, "bomberos_pe", b)).statusCode).toBe(200);
  });
});

describe("actualizaciones oficiales (ADR 0153)", () => {
  const post = (u: TestUser, payload: Record<string, unknown>) => t.app.inject({ method: "POST", url: "/v1/posts", headers: auth(u), payload });

  it("solo la institución, dentro de su ámbito y sobre un evento; se vincula como UPDATE y no verifica", async () => {
    await setVerification("bomberos_pe", "INSTITUTIONAL_OFFICIAL");
    await setScope("bomberos_pe", { categories: ["fire"], countries: ["PE"] });
    const eventId = await fireEvent("vecino_update", { lat: -12.5, lng: -76.6 });
    const text = "Tres unidades trabajando en la zona; eviten la avenida.";

    expect((await post(owner, { text, official: true, asBusiness: "bomberos_pe" })).statusCode).toBe(400);
    expect((await post(owner, { text, official: true, eventId })).statusCode).toBe(400);
    const intruder = await createUser(t, "intruso_update");
    expect((await post(intruder, { text, official: true, eventId, asBusiness: "bomberos_pe" })).statusCode).toBe(404);
    const u = await createUser(t, "choque_update");
    const crash = (await submit(t, u, reportBody(u, { category: "accident.traffic", pin: { lat: -12.55, lng: -76.55 } }))).body.eventId!;
    await t.c.dispatcher.drain();
    const out = await post(owner, { text, official: true, eventId: crash, asBusiness: "bomberos_pe" });
    expect(out.statusCode).toBe(403);
    expect(out.json()).toMatchObject({ error: "OUT_OF_SCOPE" });

    const ok = await post(owner, { text, official: true, eventId, asBusiness: "bomberos_pe" });
    expect(ok.statusCode, ok.body).toBe(201);
    const postId = ok.json().postId as string;
    expect((await t.c.db.query(`SELECT kind FROM social.posts WHERE id = $1`, [postId])).rows[0]).toEqual({ kind: "OFFICIAL_UPDATE" });
    expect((await t.c.db.query(`SELECT link_type FROM social.post_event_links WHERE post_id = $1`, [postId])).rows[0]).toEqual({ link_type: "UPDATE" });
    await t.c.dispatcher.drain();
    expect((await state(eventId)).level).toBe("UNVERIFIED");
    const feed = (await t.app.inject({ url: `/v1/events/${eventId}/posts` })).json() as { posts: { id: string; kind: string }[] };
    expect(feed.posts.find((p) => p.id === postId)?.kind).toBe("OFFICIAL_UPDATE");
    // Una actualización oficial no se edita (queda como la publicó la institución).
    expect((await t.app.inject({ method: "PATCH", url: `/v1/posts/${postId}`, headers: auth(owner), payload: { text: "otra cosa" } })).statusCode).toBe(409);

    // Sin sello deja de poder publicarlas.
    await setVerification("bomberos_pe", "VERIFIED");
    expect((await post(owner, { text, official: true, eventId, asBusiness: "bomberos_pe" })).statusCode).toBe(403);
  });
});

describe("aviso de actualizaciones oficiales (ADR 0157)", () => {
  it("avisa a quien sigue el evento con el nombre de la institución, una vez por ventana", async () => {
    await setVerification("bomberos_pe", "INSTITUTIONAL_OFFICIAL");
    await setScope("bomberos_pe", { categories: ["fire"], countries: ["PE"] });
    const eventId = await fireEvent("vecino_aviso", { lat: -12.6, lng: -76.5 });
    const fan = await createUser(t, "sigue_incendio");
    const nadie = await createUser(t, "no_sigue");
    expect((await t.app.inject({ method: "PUT", url: `/v1/follows/event/${eventId}`, headers: auth(fan) })).statusCode).toBe(200);
    const post = (text: string) => t.app.inject({ method: "POST", url: "/v1/posts", headers: auth(owner), payload: { text, official: true, eventId, asBusiness: "bomberos_pe" } });
    expect((await post("Controlado al 80 %.")).statusCode).toBe(201);
    await t.c.dispatcher.drain();
    const inbox = async (u: TestUser) => ((await t.app.inject({ url: "/v1/me/notifications", headers: auth(u) })).json() as { notifications: { kind: string; title: string; body: string; eventId: string | null }[] })
      .notifications.filter((n) => n.kind === "OFFICIAL_UPDATE");
    const got = await inbox(fan);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ title: "Cuerpo de Bomberos · Actualización oficial", eventId });
    expect(got[0]!.body).not.toContain("80");
    expect(await inbox(nadie)).toEqual([]);
    // Otra actualización enseguida queda en el feed, sin otro aviso.
    expect((await post("Controlado al 100 %.")).statusCode).toBe(201);
    await t.c.dispatcher.drain();
    expect(await inbox(fan)).toHaveLength(1);
  });
});
