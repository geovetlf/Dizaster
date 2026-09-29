import type { EventSummary, ModeratorEventDetail } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, LIMA, offset, reportBody, submit, type TestContext, type TestUser } from "./helpers.js";

let t: TestContext;
let mod: TestUser;
const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });
const REASON = "Es el mismo incendio reportado desde dos calles";

async function asModerator(handle: string): Promise<TestUser> {
  const u = await createUser(t, handle);
  await t.c.identity.grantRole(u.userId, "moderator");
  const token = (await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle, platform: "ANDROID", deviceId: u.deviceId } })).json().token as string;
  return { ...u, token };
}
const detail = async (id: string) => (await t.app.inject({ url: `/v1/moderation/events/${id}`, headers: auth(mod) })).json() as ModeratorEventDetail;
const event = async (id: string) => (await t.app.inject({ url: `/v1/events/${id}` })).json() as EventSummary & { mergedIntoId: string | null };
const reportEvent = async (reportId: string) => (await t.c.db.query<{ event_id: string }>(`SELECT event_id FROM report.reports WHERE id = $1`, [reportId])).rows[0]!.event_id;
const postLinks = async (postId: string) =>
  (await t.c.db.query<{ event_id: string }>(`SELECT event_id FROM social.post_event_links WHERE post_id = $1 ORDER BY event_id`, [postId])).rows.map((r) => r.event_id);

beforeAll(async () => {
  t = await createTestContext();
  mod = await asModerator("mod_eventos");
});
afterAll(() => t.close());

describe("fusión y división de eventos por moderación (ADR 0034)", () => {
  let a1: Awaited<ReturnType<typeof submit>>["body"];
  let a2: Awaited<ReturnType<typeof submit>>["body"];
  let b1: Awaited<ReturnType<typeof submit>>["body"];
  let A: string;
  let B: string;
  let mergeId: string;

  beforeAll(async () => {
    const [u1, u2, u3] = await Promise.all(["vecina_a1", "vecino_a2", "vecina_b1"].map((h) => createUser(t, h)));
    a1 = (await submit(t, u1!, reportBody(u1!, { category: "fire.structure", pin: LIMA }))).body;
    a2 = (await submit(t, u2!, reportBody(u2!, { category: "fire.structure", pin: offset(LIMA, 30) }))).body;
    b1 = (await submit(t, u3!, reportBody(u3!, { category: "fire.structure", pin: offset(LIMA, 20_000) }))).body;
    await t.c.dispatcher.drain();
    A = a1.eventId!;
    B = b1.eventId!;
    expect(a2.eventId).toBe(A);
    expect(B).not.toBe(A);
  });

  it("solo moderación puede fusionar; un evento no se fusiona consigo mismo", async () => {
    const [u] = await Promise.all([createUser(t, "curioso")]);
    expect((await t.app.inject({ method: "POST", url: `/v1/moderation/events/${A}/merge`, headers: auth(u!), payload: { sourceEventIds: [B], reason: REASON } })).statusCode).toBe(403);
    expect((await t.app.inject({ method: "POST", url: `/v1/moderation/events/${A}/merge`, headers: auth(mod), payload: { sourceEventIds: [A], reason: REASON } })).statusCode).toBe(400);
    expect((await t.app.inject({ method: "POST", url: `/v1/moderation/events/${A}/merge`, headers: auth(mod), payload: { sourceEventIds: [B], reason: "corto" } })).statusCode).toBe(400);
  });

  it("fusionar mueve evidencias, reportes y posts al destino y redirige el duplicado", async () => {
    const res = await t.app.inject({ method: "POST", url: `/v1/moderation/events/${A}/merge`, headers: auth(mod), payload: { sourceEventIds: [B], reason: REASON } });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { mergeIds: string[]; event: ModeratorEventDetail };
    mergeId = body.mergeIds[0]!;
    expect(body.event.evidence).toHaveLength(3);
    expect(body.event.merges[0]).toMatchObject({ id: mergeId, targetEventId: A, mergedEventId: B, movedEvidence: 1, revertedAt: null });
    await t.c.dispatcher.drain();

    expect((await event(B)).mergedIntoId).toBe(A);
    expect((await event(A)).reportCount).toBe(3);
    expect(await reportEvent(b1.reportId!)).toBe(A);
    expect(await postLinks(b1.postId!)).toEqual([A]);
    const timeline = (await t.app.inject({ url: `/v1/events/${A}/timeline` })).json() as { entries: { type: string; payload: Record<string, unknown> }[] };
    expect(timeline.entries.find((e) => e.type === "MERGED")?.payload).toEqual({ mergedEventId: B });
    // La reputación ve a quien reportó el duplicado como parte del evento destino.
    expect((await t.c.db.query(`SELECT 1 FROM trust.contributions WHERE event_id = $1`, [A])).rowCount).toBe(3);

    const again = await t.app.inject({ method: "POST", url: `/v1/moderation/events/${A}/merge`, headers: auth(mod), payload: { sourceEventIds: [B], reason: REASON } });
    expect(again.statusCode).toBe(409);
  });

  it("revertir devuelve evidencias, reportes y posts; no se revierte dos veces", async () => {
    const res = await t.app.inject({ method: "POST", url: `/v1/moderation/merges/${mergeId}/revert`, headers: auth(mod), payload: { reason: "No era el mismo incendio, son dos casas" } });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ targetEventId: A, restoredEventId: B });
    await t.c.dispatcher.drain();
    expect((await event(B)).mergedIntoId).toBeNull();
    expect((await event(A)).reportCount).toBe(2);
    expect((await event(B)).reportCount).toBe(1);
    expect(await reportEvent(b1.reportId!)).toBe(B);
    expect(await postLinks(b1.postId!)).toEqual([B]);
    expect((await detail(A)).merges[0]!.revertedAt).not.toBeNull();
    expect((await t.app.inject({ method: "POST", url: `/v1/moderation/merges/${mergeId}/revert`, headers: auth(mod), payload: { reason: "Otra vez por error" } })).statusCode).toBe(409);
  });

  it("dividir saca evidencias a un evento nuevo con su reporte y su post; el original no puede quedar vacío", async () => {
    const before = await detail(A);
    const picked = before.evidence[1]!;
    const all = before.evidence.map((e) => e.id);
    expect((await t.app.inject({ method: "POST", url: `/v1/moderation/events/${A}/split`, headers: auth(mod), payload: { evidenceIds: all, reason: REASON } })).statusCode).toBe(409);

    const res = await t.app.inject({ method: "POST", url: `/v1/moderation/events/${A}/split`, headers: auth(mod), payload: { evidenceIds: [picked.id], reason: "Son dos incendios en la misma cuadra" } });
    expect(res.statusCode, res.body).toBe(201);
    const C = (res.json() as { eventId: string }).eventId;
    await t.c.dispatcher.drain();
    expect((await event(A)).reportCount).toBe(1);
    expect(await event(C)).toMatchObject({ categoryCode: "fire.structure", reportCount: 1 });
    // Cada reporte queda donde está su evidencia, y su post con él.
    const where = [await reportEvent(a1.reportId!), await reportEvent(a2.reportId!)];
    expect([...where].sort()).toEqual([A, C].sort());
    const movedPost = where[0] === C ? a1.postId! : a2.postId!;
    expect(await postLinks(movedPost)).toEqual([C]);
    expect((await t.c.db.query(`SELECT 1 FROM verification.state WHERE event_id = $1`, [C])).rowCount).toBe(1);
    expect((await t.app.inject({ method: "POST", url: `/v1/moderation/events/${A}/split`, headers: auth(mod), payload: { evidenceIds: [picked.id], reason: "Repetido por error" } })).statusCode).toBe(400);
  });
});
