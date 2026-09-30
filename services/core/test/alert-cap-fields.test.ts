import type { NotificationsResponse } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NormalizedItem } from "../src/modules/ingestion/index.js";
import { actAsOfficial, createTestContext, createUser, LIMA, offset, reportBody, seedGeoFixtures, submit, type TestContext, type TestUser } from "./helpers.js";

// Campos CAP de la alerta (ADR 0174): origen, vencimiento y referencia. NO AI REQUIRED.
let t: TestContext;
let u: TestUser;
beforeAll(async () => {
  t = await createTestContext();
  await seedGeoFixtures(t);
  for (const key of ["ptwc-tsunami", "usgs-earthquakes"]) {
    await actAsOfficial(t, key);
    await t.c.ingestion.setSourceStatus(key, "ACTIVE");
  }
  u = await createUser(t, "capfields");
  await t.app.inject({ method: "PUT", url: "/v1/me/alert-preferences", headers: auth(u), payload: { nearMe: true } });
});
afterAll(async () => { await t.close(); });

const auth = (x: TestUser) => ({ authorization: `Bearer ${x.token}` });
const inbox = async () => (await t.app.inject({ url: "/v1/me/notifications", headers: auth(u) })).json() as NotificationsResponse;

async function ingest(key: string, externalId: string, point: { lat: number; lng: number }, endsAt: string | null, categoryCode = "natural.earthquake") {
  await t.app.inject({ method: "PUT", url: "/v1/me/approximate-location", headers: auth(u), payload: offset(point, 100) });
  const now = new Date().toISOString();
  const item: NormalizedItem = {
    externalId, categoryCode, point, uncertaintyM: 1000, occurredAt: now, publishedAt: now,
    title: { es: "Sismo" }, severity: 4, assertion: "OCCURRING", endsAt, raw: {},
  };
  const r = await t.c.ingestion.ingest(key, item, "URGENT");
  await t.c.dispatcher.drain();
  return (r.resolution as { eventId: string }).eventId;
}

describe("campos CAP en las alertas", () => {
  it("una alerta CAP oficial lleva origen OFFICIAL, su referencia y el vencimiento de la fuente", async () => {
    const ends = new Date(Date.now() + 6 * 3_600_000).toISOString();
    const eventId = await ingest("ptwc-tsunami", "PTWC-2026-1", LIMA, ends, "natural.tsunami");
    const n = (await inbox()).notifications.find((x) => x.eventId === eventId);
    expect(n).toMatchObject({ origin: "OFFICIAL", capRef: "ptwc-tsunami:PTWC-2026-1", expiresAt: ends });
  });

  it("una fuente oficial sin CAP no lleva referencia y vence al plazo por defecto", async () => {
    const eventId = await ingest("usgs-earthquakes", "us-cap-2", offset(LIMA, 600_000), null);
    const n = (await inbox()).notifications.find((x) => x.eventId === eventId)!;
    expect(n).toMatchObject({ origin: "OFFICIAL", capRef: null });
    const h = (Date.parse(n.expiresAt!) - Date.now()) / 3_600_000;
    expect(h).toBeGreaterThan(23);
    expect(h).toBeLessThanOrEqual(24);
  });

  it("lo que vence antes de salir queda en el historial sin sonar", async () => {
    const { rows } = await t.c.db.query<{ id: string }>(`SELECT id FROM alert.notifications WHERE profile_id = $1 LIMIT 1`, [u.profileId]);
    await t.c.db.query(`UPDATE alert.notifications SET status = 'PENDING', pushed_at = NULL WHERE id = $1`, [rows[0]!.id]);
    await t.c.db.query(`UPDATE alert.alerts SET expires_at = now() - interval '1 minute' WHERE id = (SELECT alert_id FROM alert.notifications WHERE id = $1)`, [rows[0]!.id]);
    const counts = await t.c.alerts.flush();
    expect(counts.EXPIRED).toBe(1);
    expect((await inbox()).notifications.find((x) => x.id === rows[0]!.id)?.delivery).toBe("EXPIRED");
  });

  it("un aviso de la fuente ya vencido no abre evento ni suena (ADR 0241)", async () => {
    const past = new Date(Date.now() - 3_600_000).toISOString();
    await t.app.inject({ method: "PUT", url: "/v1/me/approximate-location", headers: auth(u), payload: offset(LIMA, 900_100) });
    const now = new Date().toISOString();
    const r = await t.c.ingestion.ingest("ptwc-tsunami", {
      externalId: "PTWC-OLD-1", categoryCode: "natural.tsunami", point: offset(LIMA, 900_000), uncertaintyM: 1000, occurredAt: now, publishedAt: now,
      title: { es: "Tsunami" }, severity: 5, assertion: "OCCURRING", endsAt: past, raw: {},
    } as NormalizedItem, "URGENT");
    expect(r.resolution?.kind).not.toBe("CREATED");
  });

  it("si el aviso oficial ya venció al confirmar un evento existente, la alerta queda EXPIRED sin sonar (ADR 0241)", async () => {
    const pin = offset(LIMA, 1_200_000);
    await t.app.inject({ method: "PUT", url: "/v1/me/approximate-location", headers: auth(u), payload: offset(pin, 100) });
    const w = await createUser(t, "testigo_vencido");
    const rep = await submit(t, w, reportBody(w, { category: "natural.tsunami", pin }));
    await t.c.dispatcher.drain();
    await t.c.alerts.flush();
    const past = new Date(Date.now() - 60_000).toISOString();
    const now = new Date().toISOString();
    const r = await t.c.ingestion.ingest("ptwc-tsunami", {
      externalId: "PTWC-OLD-2", categoryCode: "natural.tsunami", point: pin, uncertaintyM: 1000, occurredAt: now, publishedAt: now,
      title: { es: "Tsunami" }, severity: 5, assertion: "OCCURRING", endsAt: past, raw: {},
    } as NormalizedItem, "URGENT");
    expect((r.resolution as { eventId: string }).eventId).toBe(rep.body.eventId);
    await t.c.dispatcher.drain();
    const { rows } = await t.c.db.query<{ expires_at: Date }>(`SELECT expires_at FROM alert.alerts WHERE event_id = $1 AND origin = 'OFFICIAL'`, [rep.body.eventId]);
    expect(rows.length).toBeGreaterThan(0);
    for (const x of rows) expect(x.expires_at.getTime()).toBeLessThan(Date.now());
    const counts = await t.c.alerts.flush();
    expect(counts.SENT).toBe(0);
  });

  it("las alertas de menciones y moderación son del sistema y no vencen", async () => {
    await t.c.db.query(`INSERT INTO alert.alerts (id, kind, dedup_key, critical) VALUES (gen_random_uuid(), 'MODERATION', 'cap-test', false)`);
    const r = await t.c.db.query<{ origin: string; expires_at: Date | null }>(`SELECT origin, expires_at FROM alert.alerts WHERE dedup_key = 'cap-test'`);
    expect(r.rows[0]).toEqual({ origin: "SYSTEM", expires_at: null });
  });
});
