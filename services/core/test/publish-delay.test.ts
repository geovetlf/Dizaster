import type { FeedResponse } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { nextPublication, publishDelayMinutes } from "../src/modules/event/index.js";
import { createTestContext, createUser, LIMA, offset, reportBody, submit, type TestContext, type TestUser } from "./helpers.js";

let t: TestContext;
const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });
const bbox = `${LIMA.lng - 0.2},${LIMA.lat - 0.2},${LIMA.lng + 0.2},${LIMA.lat + 0.2}`;
const mapIds = async () => ((await t.app.inject({ url: `/v1/events?bbox=${bbox}&zoom=15` })).json() as { events: { id: string }[] }).events.map((e) => e.id);
const feedIds = async (u?: TestUser) =>
  ((await t.app.inject({ url: "/v1/feed?tab=for_you", ...(u ? { headers: auth(u) } : {}) })).json() as FeedResponse).posts.map((p) => p.id);

beforeAll(async () => {
  t = await createTestContext();
  // El catálogo trae 0 minutos; la prueba fija un retraso sobre la configuración cargada.
  Object.assign(t.c.ref.category("crime.violence")!, { publishDelayMinutes: 30 });
});
afterAll(() => t.close());

describe("retraso de publicación en HIGHLY_SENSITIVE (ADR 0099)", () => {
  it("reglas puras: solo HIGHLY_SENSITIVE; una fuente publica en el acto", () => {
    expect(publishDelayMinutes({ sensitivity: "HIGHLY_SENSITIVE", publishDelayMinutes: 30 })).toBe(30);
    expect(publishDelayMinutes({ sensitivity: "SENSITIVE", publishDelayMinutes: 30 })).toBe(0);
    expect(nextPublication("DELAYED", { distinctContributors: 1, hasNonCitizen: true, delayPending: true })).toBe("PUBLISHED");
    expect(nextPublication("DELAYED", { distinctContributors: 3, hasNonCitizen: false, delayPending: true })).toBe("DELAYED");
    expect(nextPublication("PENDING_CORROBORATION", { distinctContributors: 2, hasNonCitizen: false, delayPending: true })).toBe("DELAYED");
    expect(nextPublication("PENDING_CORROBORATION", { distinctContributors: 2, hasNonCitizen: false, delayPending: false })).toBe("PUBLISHED");
    expect(nextPublication("HIDDEN", { distinctContributors: 5, hasNonCitizen: true, delayPending: false })).toBe("HIDDEN");
  });

  it("el evento y el post esperan; solo quien reporta ve su post; al vencer se publica y avisa", async () => {
    const [ana, otro] = await Promise.all([createUser(t, "ana_delay"), createUser(t, "otro_delay")]);
    const r = await submit(t, ana, reportBody(ana, { category: "crime.violence", pin: offset(LIMA, 500) }));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.outcome).toBe("CREATED_EVENT");
    const publishAfter = Date.parse((r.body as { publishAfter?: string }).publishAfter!);
    expect(publishAfter - Date.now()).toBeGreaterThan(29 * 60_000);
    await t.c.dispatcher.drain();

    const eventId = r.body.eventId!;
    expect(await mapIds()).not.toContain(eventId);
    expect((await t.app.inject({ url: `/v1/events/${eventId}` })).statusCode).toBe(404);
    // Ni la timeline ni la verificación lo delatan (ADR 0103).
    for (const sub of ["timeline", "verification", "sources", "media"]) {
      expect((await t.app.inject({ url: `/v1/events/${eventId}/${sub}` })).statusCode, sub).toBe(404);
    }
    expect(await feedIds(otro)).not.toContain(r.body.postId);
    expect(await feedIds()).not.toContain(r.body.postId);
    expect(await feedIds(ana)).toContain(r.body.postId);

    // Antes de la hora no se publica nada.
    expect(await t.c.events.publishDue(t.c.db, new Date())).toBe(0);
    // Vence el retraso (se simula moviendo la hora guardada).
    await t.c.db.query(`UPDATE event.events SET publish_after = now() - interval '1 second' WHERE id = $1`, [eventId]);
    await t.c.db.query(`UPDATE social.posts SET visible_after = now() - interval '1 second' WHERE id = $1`, [r.body.postId]);
    expect(await t.c.events.publishDue(t.c.db, new Date())).toBe(1);
    await t.c.dispatcher.drain();
    expect(await mapIds()).toContain(eventId);
    expect((await t.app.inject({ url: `/v1/events/${eventId}` })).statusCode).toBe(200);
    expect((await t.app.inject({ url: `/v1/events/${eventId}/timeline` })).statusCode).toBe(200);
    expect((await t.app.inject({ url: `/v1/events/${eventId}/verification` })).statusCode).toBe(200);
    expect(await feedIds(otro)).toContain(r.body.postId);
    expect((await t.c.db.query(`SELECT 1 FROM platform.outbox WHERE type = 'EventPublished' AND payload->>'eventId' = $1`, [eventId])).rowCount).toBe(1);
  });

  it("otras categorías no esperan", async () => {
    const u = await createUser(t, "sin_delay");
    const r = await submit(t, u, reportBody(u, { category: "accident.traffic", pin: offset(LIMA, -3000) }));
    expect((r.body as { publishAfter?: string }).publishAfter).toBeUndefined();
    expect((await t.app.inject({ url: `/v1/events/${r.body.eventId}` })).statusCode).toBe(200);
  });

  it("el catálogo trae 5 minutos para violencia y administración lo cambia sin desplegar (ADR 0109)", async () => {
    const { ReferenceData } = await import("../src/modules/reference/index.js");
    expect(new ReferenceData(t.c.ref.dataDir).category("crime.violence")!.publishDelayMinutes).toBe(5);

    const admin = await createUser(t, "admin_delay");
    await t.c.identity.grantRole(admin.userId, "admin");
    const token = (await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle: "admin_delay", platform: "ANDROID", deviceId: admin.deviceId } })).json().token as string;
    const put = (code: string, minutes: number, as = token) =>
      t.app.inject({ method: "PUT", url: `/v1/admin/categories/${code}/publish-delay`, headers: { authorization: `Bearer ${as}` }, payload: { minutes, reason: "Ajuste del piloto" } });

    const plain = await createUser(t, "no_admin_delay");
    expect((await put("crime.violence", 7, plain.token)).statusCode).toBe(403);
    expect((await put("accident.traffic", 7)).statusCode).toBe(400);
    expect((await put("crime.violence", 2000)).statusCode).toBe(400);
    expect((await put("no.existe", 7)).statusCode).toBe(404);
    const ok = await put("crime.violence", 7);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ category: "crime.violence", minutes: 7, catalogMinutes: 30, overridden: true });

    const u = await createUser(t, "rep_delay7");
    const r = await submit(t, u, reportBody(u, { category: "crime.violence", pin: offset(LIMA, 8000) }));
    const wait = Date.parse((r.body as { publishAfter?: string }).publishAfter!) - Date.now();
    expect(wait).toBeGreaterThan(6 * 60_000);
    expect(wait).toBeLessThan(8 * 60_000);
    await t.c.db.query(`DELETE FROM event.category_settings`);
  });
});
