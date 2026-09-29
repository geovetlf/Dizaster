import type { MyReportView } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, reportBody, submit, type TestContext, type TestUser } from "./helpers.js";

let t: TestContext;
const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });
const mine = async (u: TestUser) => {
  const res = await t.app.inject({ url: "/v1/me/reports", headers: auth(u) });
  expect(res.statusCode, res.body).toBe(200);
  expect(res.headers["cache-control"]).toBe("no-store");
  return (res.json() as { reports: MyReportView[] }).reports;
};

beforeAll(async () => { t = await createTestContext(); });
afterAll(() => t.close());

describe("mis reportes (ADR 0094)", () => {
  it("lista solo los reportes propios, con estado, EVENT y borrado de la ubicación precisa", async () => {
    const [ana, beto] = await Promise.all([createUser(t, "ana_reporta"), createUser(t, "beto_reporta")]);
    const r = (await submit(t, ana!, reportBody(ana!, { text: "choque en la avenida" }))).body;
    await submit(t, beto!, reportBody(beto!));
    await t.c.dispatcher.drain();

    const list = await mine(ana!);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: r.reportId, postId: r.postId, eventId: r.eventId, categoryCode: "accident.traffic", assertion: "OCCURRING", status: "ACCEPTED", preciseLocationRemovedAt: null, presenceReviews: 0 });
    expect(Date.parse(list[0]!.preciseLocationRemovesAt!)).toBeGreaterThan(Date.now());
    // Nada del sistema antiabuso ni de la ubicación.
    expect(Object.keys(list[0]!)).not.toEqual(expect.arrayContaining(["presenceScore"]));
    expect(JSON.stringify(list[0])).not.toMatch(/lat|lng|presence_band|presenceBand/);
    expect((await t.app.inject({ url: "/v1/me/reports" })).statusCode).toBe(401);
  });

  it("retirar un reporte propio borra la ubicación precisa y el post; el ajeno da 404", async () => {
    const [caro, dani] = await Promise.all([createUser(t, "caro_reporta"), createUser(t, "dani_reporta")]);
    const r = (await submit(t, caro!, reportBody(caro!))).body;
    expect((await t.app.inject({ method: "DELETE", url: `/v1/me/reports/${r.reportId}`, headers: auth(dani!) })).statusCode).toBe(404);
    expect((await t.app.inject({ method: "DELETE", url: `/v1/me/reports/${r.reportId}`, headers: auth(caro!) })).statusCode).toBe(204);
    // Idempotente.
    expect((await t.app.inject({ method: "DELETE", url: `/v1/me/reports/${r.reportId}`, headers: auth(caro!) })).statusCode).toBe(204);
    const [w] = await mine(caro!);
    expect(w).toMatchObject({ id: r.reportId, status: "WITHDRAWN", postId: null, preciseLocationRemovesAt: null });
    expect(w!.preciseLocationRemovedAt).not.toBeNull();
    expect((await t.app.inject({ url: `/v1/posts/${r.postId}` })).statusCode).toBe(404);
  });
});
