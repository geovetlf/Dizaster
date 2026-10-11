import type { MyProfile, ProfileView } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, LIMA, offset, reportBody, submit, type TestContext, type TestUser } from "./helpers.js";

/**
 * D3 (decisión del propietario, ADR 0315 y 0321): el perfil público muestra «N reportes corroborados», que cada
 * persona puede ocultar. Sin puntajes internos ni evidencia privada; la confirmación oficial va aparte; el recuento
 * resiste duplicados y manipulación.
 */
let t: TestContext;
let a: TestUser;
let b: TestUser;
let c: TestUser;
let eventId: string;
const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });
const handleOf = async (u: TestUser) => (await t.c.db.query<{ handle: string }>(`SELECT handle FROM social.profiles WHERE id = $1`, [u.profileId])).rows[0]!.handle;
const profile = async (u: TestUser, viewer?: TestUser) =>
  (await t.app.inject({ url: `/v1/profiles/${await handleOf(u)}`, ...(viewer ? { headers: auth(viewer) } : {}) })).json() as ProfileView;
const pin = offset(LIMA, 0, 30000);

beforeAll(async () => {
  t = await createTestContext();
  [a, b, c] = await Promise.all(["corr_a", "corr_b", "corr_c"].map((h) => createUser(t, h))) as [TestUser, TestUser, TestUser];
  eventId = (await submit(t, a, reportBody(a, { pin }))).body.eventId!;
  await submit(t, b, reportBody(b, { pin: offset(pin, 20) }));
  await submit(t, c, reportBody(c, { pin: offset(pin, -20) }));
  await t.c.dispatcher.drain();
  expect((await t.app.inject({ url: `/v1/events/${eventId}` })).json().verificationLevel).toBe("COMMUNITY_CORROBORATED");
});
afterAll(() => t.close());

describe("reportes corroborados en el perfil público", () => {
  it("cuenta eventos corroborados distintos; un evento sin corroborar no suma", async () => {
    expect((await profile(a)).corroboratedReports).toEqual({ total: 1, official: 0 });
    // Otro reporte suyo sobre el mismo evento no suma: se cuentan eventos, no reportes.
    await submit(t, a, reportBody(a, { pin: offset(pin, 40) }));
    // Y un evento que solo reportó ella, sin corroborar, tampoco.
    await submit(t, a, reportBody(a, { pin: offset(LIMA, 0, 45000) }));
    await t.c.dispatcher.drain();
    expect((await profile(a)).corroboratedReports).toEqual({ total: 1, official: 0 });
  });

  it("no publica puntajes ni evidencia privada", async () => {
    const body = JSON.stringify(await profile(a, b));
    for (const leak of ["presence", "score", "trust", "lowTrust", "low_trust", "band", "fix"]) expect(body).not.toContain(leak);
  });

  it("un reporte seudónimo nunca suma: el perfil no puede delatarlo", async () => {
    const d = await createUser(t, "corr_seudo");
    await submit(t, d, { ...reportBody(d, { pin: offset(pin, 10) }), anonymityMode: "PSEUDONYMOUS" });
    await t.c.dispatcher.drain();
    expect((await profile(d)).corroboratedReports).toEqual({ total: 0, official: 0 });
  });

  it("presencia baja no suma: no basta con sumarse desde lejos a un evento ajeno", async () => {
    const lejos = await createUser(t, "corr_lejos");
    const r = await submit(t, lejos, reportBody(lejos, { pin: offset(pin, 5), fix: offset(pin, 3000) }));
    await t.c.dispatcher.drain();
    const band = (await t.c.db.query<{ presence_band: string }>(`SELECT presence_band FROM report.reports WHERE id = $1`, [r.body.reportId])).rows[0]?.presence_band;
    expect(band === "LOW" || r.body.outcome === "DOWNGRADED_TO_POST").toBe(true);
    expect((await profile(lejos)).corroboratedReports).toEqual({ total: 0, official: 0 });
  });

  it("la confirmación oficial se distingue; en disputa, falso u oculto deja de contar", async () => {
    await t.c.db.query(`UPDATE event.events SET verification_level = 'OFFICIALLY_CONFIRMED' WHERE id = $1`, [eventId]);
    expect((await profile(b)).corroboratedReports).toEqual({ total: 1, official: 1 });
    await t.c.db.query(`UPDATE event.events SET negative_state = 'DISPUTED' WHERE id = $1`, [eventId]);
    expect((await profile(b)).corroboratedReports).toEqual({ total: 0, official: 0 });
    await t.c.db.query(`UPDATE event.events SET negative_state = 'NONE', verification_level = 'COMMUNITY_CORROBORATED' WHERE id = $1`, [eventId]);
    // Moderación retira el reporte de B: su evidencia deja de contar (decisión de moderación del 2026-09-29).
    await t.c.db.query(`UPDATE event.evidence SET status = 'MODERATED' WHERE evidence_type = 'CITIZEN_REPORT' AND ref_id IN (SELECT id FROM report.reports WHERE author_user_id = $1)`, [b.userId]);
    expect((await profile(b)).corroboratedReports).toEqual({ total: 0, official: 0 });
    expect((await profile(c)).corroboratedReports).toEqual({ total: 1, official: 0 });
  });

  it("cada persona puede ocultarlo, y entonces no lo ve nadie", async () => {
    const res = await t.app.inject({ method: "PATCH", url: "/v1/me", headers: auth(c), payload: { showCorroboratedReports: false } });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as MyProfile).showCorroboratedReports).toBe(false);
    expect((await profile(c)).corroboratedReports).toBeNull();
    expect((await profile(c, a)).corroboratedReports).toBeNull();
    expect((await profile(c, c)).corroboratedReports).toBeNull();
    await t.app.inject({ method: "PATCH", url: "/v1/me", headers: auth(c), payload: { showCorroboratedReports: true } });
    expect((await profile(c)).corroboratedReports).toEqual({ total: 1, official: 0 });
  });
});
