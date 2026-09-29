import type { CaseSummary } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, LIMA, offset, reportBody, submit, type TestContext, type TestUser } from "./helpers.js";

// Reportes ocultos o retirados por moderación dejan de contar para el evento; Restaurar los devuelve (ADR 0143).
let t: TestContext;
let mod: TestUser;
const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });
const eventRow = async (id: string) =>
  (await t.c.db.query<{ report_count: number; publication_state: string }>(`SELECT report_count, publication_state FROM event.events WHERE id = $1`, [id])).rows[0]!;

async function asRole(handle: string, role: "moderator"): Promise<TestUser> {
  const u = await createUser(t, handle);
  await t.c.identity.grantRole(u.userId, role);
  const token = (await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle, platform: "ANDROID", deviceId: u.deviceId } })).json().token as string;
  return { ...u, token };
}
async function moderate(postId: string, action: "HIDE" | "REMOVE" | "RESTORE", flagger: TestUser) {
  if (action !== "RESTORE") await t.app.inject({ method: "POST", url: "/v1/flags", headers: auth(flagger), payload: { targetType: "POST", targetId: postId, reason: "SPAM" } });
  const cases = (await t.app.inject({ url: "/v1/moderation/cases", headers: auth(mod) })).json().cases as CaseSummary[];
  let caseId = cases.find((c) => c.target.id === postId)?.id;
  if (!caseId) {
    await t.app.inject({ method: "POST", url: "/v1/flags", headers: auth(flagger), payload: { targetType: "POST", targetId: postId, reason: "OTHER", note: "revisar" } });
    caseId = ((await t.app.inject({ url: "/v1/moderation/cases", headers: auth(mod) })).json().cases as CaseSummary[]).find((c) => c.target.id === postId)!.id;
  }
  const res = await t.app.inject({ method: "POST", url: `/v1/moderation/cases/${caseId}/actions`, headers: auth(mod), payload: { action, reason: "Decisión de moderación de prueba" } });
  expect(res.statusCode).toBe(200);
  await t.c.dispatcher.drain();
}

beforeAll(async () => {
  t = await createTestContext();
  mod = await asRole("moderadora_rep", "moderator");
});
afterAll(() => t.close());

describe("reportes moderados y el evento", () => {
  it("ocultar deja de contarlo; restaurar lo devuelve", async () => {
    const [a, b, f] = await Promise.all([createUser(t, "mod_rep_a"), createUser(t, "mod_rep_b"), createUser(t, "mod_rep_f")]);
    const ra = (await submit(t, a!, reportBody(a!, { category: "infra.power_outage", pin: offset(LIMA, 3000) }))).body;
    const rb = (await submit(t, b!, reportBody(b!, { category: "infra.power_outage", pin: offset(LIMA, 3020) }))).body;
    await t.c.dispatcher.drain();
    const eventId = ra.eventId!;
    expect(rb.eventId).toBe(eventId);
    expect((await eventRow(eventId)).report_count).toBe(2);

    await moderate(ra.postId!, "HIDE", f!);
    expect(await eventRow(eventId)).toEqual({ report_count: 1, publication_state: "PUBLISHED" });
    await moderate(ra.postId!, "RESTORE", f!);
    expect(await eventRow(eventId)).toEqual({ report_count: 2, publication_state: "PUBLISHED" });
    const tl = (await t.app.inject({ url: `/v1/events/${eventId}/timeline` })).json() as { entries: { type: string }[] };
    expect(tl.entries.map((e) => e.type)).toEqual(expect.arrayContaining(["REPORT_MODERATED", "REPORT_RESTORED"]));
  });

  it("retirar el único reporte oculta el evento y restaurarlo lo vuelve a publicar", async () => {
    const [u, f] = await Promise.all([createUser(t, "mod_solo"), createUser(t, "mod_solo_f")]);
    const r = (await submit(t, u!, reportBody(u!, { category: "infra.power_outage", pin: offset(LIMA, 12000) }))).body;
    await t.c.dispatcher.drain();
    const before = (await eventRow(r.eventId!)).publication_state;
    await moderate(r.postId!, "REMOVE", f!);
    expect(await eventRow(r.eventId!)).toEqual({ report_count: 0, publication_state: "HIDDEN" });
    await moderate(r.postId!, "RESTORE", f!);
    expect(await eventRow(r.eventId!)).toEqual({ report_count: 1, publication_state: before });
  });

  it("un reporte retirado por su autor no vuelve con Restaurar", async () => {
    const [u, f] = await Promise.all([createUser(t, "mod_retira"), createUser(t, "mod_retira_f")]);
    const r = (await submit(t, u!, reportBody(u!, { category: "infra.power_outage", pin: offset(LIMA, 20000) }))).body;
    await t.c.dispatcher.drain();
    await moderate(r.postId!, "HIDE", f!);
    await t.app.inject({ method: "DELETE", url: `/v1/posts/${r.postId}`, headers: auth(u!) });
    await t.c.dispatcher.drain();
    const status = async () => (await t.c.db.query<{ status: string }>(`SELECT status FROM event.evidence WHERE ref_id = $1`, [r.reportId])).rows[0]!.status;
    expect(await status()).toBe("DETACHED");
  });
});
