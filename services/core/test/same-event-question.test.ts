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

/** Todo lo que describe un evento y su agrupación: si "No, es otro" tocara algo, esto cambiaría. */
async function eventFootprint(eventId: string) {
  const q = async (sql: string, params: unknown[] = [eventId]) => (await t.c.db.query(sql, params)).rows;
  return {
    event: await q(`SELECT * FROM event.events WHERE id = $1`),
    events: await q(`SELECT count(*)::int AS n FROM event.events`, []),
    evidence: await q(`SELECT id, evidence_type, ref_id FROM event.evidence WHERE event_id = $1 ORDER BY id`),
    timeline: await q(`SELECT count(*)::int AS n FROM event.timeline WHERE event_id = $1`),
    statusLog: await q(`SELECT count(*)::int AS n FROM event.status_log WHERE event_id = $1`),
    merges: await q(`SELECT count(*)::int AS n FROM event.merge_log`, []),
    splits: await q(`SELECT count(*)::int AS n FROM event.split_log`, []),
    duplicates: await q(`SELECT count(*)::int AS n FROM event.duplicate_candidates`, []),
  };
}

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
    await t.c.dispatcher.drain();
    const before = await eventFootprint(first.eventId!);
    expect((await answer(c!, third.reportId!, "DIFFERENT")).statusCode).toBe(200);
    await t.c.dispatcher.drain();
    // D2 (decisión del propietario, ADR 0315): "No" solo se registra. La revisión sigue abierta, el reporte sigue en
    // el evento y nada del evento cambia: ni su fila, ni su línea de tiempo, ni sus registros, ni la cola de duplicados.
    expect(await review(third.reportId!)).toEqual({ status: "OPEN", reporter_answer: "DIFFERENT" });
    expect((await t.c.db.query(`SELECT event_id FROM report.reports WHERE id = $1`, [third.reportId])).rows[0]).toEqual({ event_id: first.eventId });
    expect(await eventFootprint(first.eventId!)).toEqual(before);
    expect((await answer(a!, first.reportId!, "SAME")).statusCode).toBe(409);

    // Mi respuesta sale en mi exportación de datos (ADR 0256), sin candidatos ni puntuación.
    const exported = (await t.app.inject({ url: "/v1/me/export", headers: auth(c!) })).json().sections.reports.sameEventAnswers;
    expect(exported).toEqual([{ report_id: third.reportId, answer: "DIFFERENT", answered_at: expect.any(String) }]);
  });
});
