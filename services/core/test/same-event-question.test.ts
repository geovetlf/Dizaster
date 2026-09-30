import type { MyReportView } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, LIMA, offset, reportBody, submit, type TestContext, type TestUser } from "./helpers.js";

let t: TestContext;
const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });
beforeAll(async () => { t = await createTestContext(); });
afterAll(() => t.close());

const answer = (u: TestUser, reportId: string, a: string) =>
  t.app.inject({ method: "POST", url: `/v1/me/reports/${reportId}/match`, headers: auth(u), payload: { answer: a } });
const mine = async (u: TestUser) => (await t.app.inject({ url: "/v1/me/reports", headers: auth(u) })).json().reports as MyReportView[];
const review = async (reportId: string) => (await t.c.db.query(
  `SELECT r.status, r.reporter_answer FROM event.dedup_reviews r JOIN event.evidence e ON e.id = r.evidence_id WHERE e.ref_id = $1`, [reportId],
)).rows[0];

describe("¿Es el mismo evento? (ADR 0156)", () => {
  it("un adjunto en la franja ambigua pregunta; Sí cierra la revisión y No queda anotado", async () => {
    const pin = offset(LIMA, 60_000);
    const [a, b, c, otro] = await Promise.all(["same_a", "same_b", "same_c", "same_otro"].map((h) => createUser(t, h)));
    const first = (await submit(t, a!, reportBody(a!, { category: "fire.structure", pin }))).body;
    expect(first.outcome).toBe("CREATED_EVENT");
    expect(first).not.toHaveProperty("askSameEvent");
    await t.c.dispatcher.drain();

    const second = (await submit(t, b!, reportBody(b!, { category: "fire.structure", pin: offset(pin, 250) }))).body;
    expect(second).toMatchObject({ outcome: "ATTACHED_TO_EVENT", eventId: first.eventId, askSameEvent: true });
    expect((await mine(b!)).find((r) => r.id === second.reportId)?.askSameEvent).toBe(true);
    expect((await answer(otro!, second.reportId!, "SAME")).statusCode).toBe(404);
    expect((await answer(b!, second.reportId!, "QUIZAS")).statusCode).toBe(400);
    expect((await answer(b!, second.reportId!, "SAME")).json()).toEqual({ answer: "SAME" });
    expect(await review(second.reportId!)).toEqual({ status: "CONFIRMED", reporter_answer: "SAME" });
    expect((await mine(b!)).find((r) => r.id === second.reportId)?.askSameEvent).toBe(false);
    expect((await answer(b!, second.reportId!, "DIFFERENT")).statusCode).toBe(409);

    const third = (await submit(t, c!, reportBody(c!, { category: "fire.structure", pin: offset(pin, 260) }))).body;
    expect(third.askSameEvent).toBe(true);
    expect((await answer(c!, third.reportId!, "DIFFERENT")).statusCode).toBe(200);
    // "No" espera la decisión D2: se anota, la revisión sigue abierta y el reporte sigue en el evento.
    expect(await review(third.reportId!)).toEqual({ status: "OPEN", reporter_answer: "DIFFERENT" });
    expect((await t.c.db.query(`SELECT event_id FROM report.reports WHERE id = $1`, [third.reportId])).rows[0]).toEqual({ event_id: first.eventId });
    expect((await answer(a!, first.reportId!, "SAME")).statusCode).toBe(409);

    // Mi respuesta sale en mi exportación de datos (ADR 0256), sin candidatos ni puntuación.
    const exported = (await t.app.inject({ url: "/v1/me/export", headers: auth(c!) })).json().sections.reports.sameEventAnswers;
    expect(exported).toEqual([{ report_id: third.reportId, answer: "DIFFERENT", answered_at: expect.any(String) }]);
  });
});
