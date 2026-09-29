import type { EventSummary } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, LIMA, offset, reportBody, submit, type TestContext, type TestUser } from "./helpers.js";

let t: TestContext;
const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });
const withdraw = (u: TestUser, postId: string) => t.app.inject({ method: "DELETE", url: `/v1/posts/${postId}`, headers: auth(u) });
const eventRow = async (id: string) =>
  (await t.c.db.query<{ report_count: number; publication_state: string }>(`SELECT report_count, publication_state FROM event.events WHERE id = $1`, [id])).rows[0]!;

beforeAll(async () => { t = await createTestContext(); });
afterAll(() => t.close());

describe("retirar un reporte propio (ADR 0037)", () => {
  it("la evidencia deja de contar, el post desaparece y la presencia precisa se borra; es idempotente", async () => {
    const [a, b] = await Promise.all([createUser(t, "retira_a"), createUser(t, "retira_b")]);
    const ra = (await submit(t, a!, reportBody(a!, { category: "infra.power_outage", pin: offset(LIMA, 2000) }))).body;
    const rb = (await submit(t, b!, reportBody(b!, { category: "infra.power_outage", pin: offset(LIMA, 2020) }))).body;
    await t.c.dispatcher.drain();
    const eventId = ra.eventId!;
    expect(rb.eventId).toBe(eventId);
    expect((await eventRow(eventId)).report_count).toBe(2);

    expect((await withdraw(b!, ra.postId!)).statusCode).toBe(404);
    expect((await withdraw(a!, ra.postId!)).statusCode).toBe(204);
    await t.c.dispatcher.drain();

    expect(await eventRow(eventId)).toEqual({ report_count: 1, publication_state: "PUBLISHED" });
    const rep = (await t.c.db.query<{ status: string; device_fix: unknown }>(
      `SELECT r.status, coalesce(p.device_fix::text, p.device_fix_enc) AS device_fix FROM report.reports r JOIN report.presence_evidence p ON p.report_id = r.id WHERE r.id = $1`, [ra.reportId],
    )).rows[0]!;
    expect(rep).toEqual({ status: "WITHDRAWN", device_fix: null });
    expect((await t.c.db.query(`SELECT 1 FROM social.posts WHERE id = $1 AND deleted_at IS NOT NULL`, [ra.postId])).rowCount).toBe(1);
    // Aún sin decidir: se olvida de su historial de reputación.
    expect((await t.c.db.query(`SELECT 1 FROM trust.contributions WHERE user_id = $1`, [a!.userId])).rowCount).toBe(0);
    const tl = (await t.app.inject({ url: `/v1/events/${eventId}/timeline` })).json() as { entries: { type: string }[] };
    expect(tl.entries.map((e) => e.type)).toContain("REPORT_WITHDRAWN");
    expect((await withdraw(a!, ra.postId!)).statusCode).toBe(204);
  });

  it("si el evento se queda sin evidencias deja de mostrarse", async () => {
    const u = await createUser(t, "retira_solo");
    const r = (await submit(t, u, reportBody(u, { category: "infra.power_outage", pin: offset(LIMA, 9000) }))).body;
    await t.c.dispatcher.drain();
    expect((await withdraw(u, r.postId!)).statusCode).toBe(204);
    await t.c.dispatcher.drain();
    expect(await eventRow(r.eventId!)).toEqual({ report_count: 0, publication_state: "HIDDEN" });
    const map = (await t.app.inject({ url: `/v1/events?bbox=-77.2,-12.2,-76.9,-11.9&zoom=14` })).json() as { events?: EventSummary[] };
    expect(JSON.stringify(map)).not.toContain(r.eventId!);
  });
});
