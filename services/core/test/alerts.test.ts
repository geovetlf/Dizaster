import type { AlertPreferences, CategorySubscription, NotificationsResponse } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PushMessage, PushResult, PushSender } from "../src/modules/alert/index.js";
import { withTransaction } from "../src/platform/db.js";
import { publish } from "../src/platform/outbox.js";
import { actAsOfficial, createTestContext, createUser, offset, reportBody, seedGeoFixtures, submit, type TestContext, type TestUser, withoutPublishDelay } from "./helpers.js";

/** Proveedor push de prueba: guarda lo enviado y puede simular tokens inválidos. */
class RecordingPush implements PushSender {
  readonly name = "recording";
  sent: PushMessage[] = [];
  invalid = new Set<string>();
  async send(messages: PushMessage[]): Promise<PushResult[]> {
    this.sent.push(...messages);
    return messages.map((m) => ({ token: m.token, ok: !this.invalid.has(m.token), invalidToken: this.invalid.has(m.token) }));
  }
  take(): PushMessage[] { const s = this.sent; this.sent = []; return s; }
}

const push = new RecordingPush();
let t: TestContext;
beforeAll(async () => {
  t = await createTestContext({ push });
  await withoutPublishDelay(t, "crime.violence");
  await seedGeoFixtures(t);
  await t.c.ingestion.setSourceStatus("usgs-earthquakes", "ACTIVE");
  await actAsOfficial(t, "usgs-earthquakes");
});
afterAll(async () => { await t.close(); });

const auth = (u: TestUser) => ({ authorization: `Bearer ${u.token}` });
const drain = () => t.c.dispatcher.drain();
const follow = (u: TestUser, target: string, id: string) =>
  t.app.inject({ method: "PUT", url: `/v1/follows/${target}/${encodeURIComponent(id)}`, headers: auth(u) });
const setPrefs = async (u: TestUser, p: Partial<AlertPreferences>) => {
  const res = await t.app.inject({ method: "PUT", url: "/v1/me/alert-preferences", headers: auth(u), payload: p });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as AlertPreferences;
};
const inbox = async (u: TestUser, qs = "") => {
  const res = await t.app.inject({ url: `/v1/me/notifications${qs}`, headers: auth(u) });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as NotificationsResponse;
};
let tokenSeq = 0;
async function withDevice(u: TestUser): Promise<string> {
  const token = `fcm-token-${++tokenSeq}-${"x".repeat(20)}`;
  const res = await t.app.inject({ method: "PUT", url: `/v1/devices/${u.deviceId}/push-token`, headers: auth(u), payload: { provider: "FCM", token } });
  expect(res.statusCode, res.body).toBe(204);
  return token;
}

/** Tres personas presentes en el lugar → COMMUNITY_CORROBORATED (umbral del Verification Engine). */
async function corroborated(category: string, pin: { lat: number; lng: number }, prefix: string, opts: { pseudonymousFirst?: boolean } = {}) {
  const users = await Promise.all([1, 2, 3].map((i) => createUser(t, `${prefix}${i}`)));
  let eventId = "";
  for (const [i, u] of users.entries()) {
    const body = reportBody(u, { category, pin: offset(pin, i * 15), text: `${prefix} reporte ${i}` });
    const r = await submit(t, u, i === 0 && opts.pseudonymousFirst ? { ...body, anonymityMode: "PSEUDONYMOUS" } : body);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    eventId ||= r.body.eventId!;
    if (i === 0) await drain();
  }
  await drain();
  return { eventId, reporters: users };
}

const MIRAFLORES = { lat: -12.1211, lng: -77.0297 };
const CALLAO = { lat: -12.0566, lng: -77.1181 };

describe("Alert Engine: lugares y categorías seguidas", () => {
  let vecina: TestUser;
  let suscrita: TestUser;
  let sinDispositivo: TestUser;
  let tokenVecina: string;
  let eventId: string;
  let reporters: TestUser[];

  beforeAll(async () => {
    vecina = await createUser(t, "vecina");
    suscrita = await createUser(t, "suscrita");
    sinDispositivo = await createUser(t, "sin_dispositivo");
    tokenVecina = await withDevice(vecina);
    await withDevice(suscrita);
    expect((await follow(vecina, "place", "PE:150122")).statusCode).toBe(200);
    expect((await follow(sinDispositivo, "place", "PE:150122")).statusCode).toBe(200);
    const sub = await t.app.inject({ method: "POST", url: "/v1/me/alert-subscriptions", headers: auth(suscrita), payload: { categoryCode: "natural", areaId: "PE" } });
    expect(sub.statusCode, sub.body).toBe(201);
  });

  it("un reporte suelto (sin corroborar) no genera ninguna alerta, aunque aparezca en el feed", async () => {
    const u = await createUser(t, "suelto");
    await submit(t, u, reportBody(u, { category: "natural.flood", pin: offset(MIRAFLORES, 2500), text: "agua en la pista" }));
    await drain();
    await t.c.alerts.flush();
    expect(push.take()).toEqual([]);
    expect((await inbox(vecina)).notifications).toEqual([]);
  });

  it("al corroborarse, avisa a quien sigue el distrito y a quien sigue la categoría en el país, con deep link al EVENT", async () => {
    ({ eventId, reporters } = await corroborated("natural.flood", MIRAFLORES, "inund", { pseudonymousFirst: true }));
    const counts = await t.c.alerts.flush();
    expect(counts.SENT).toBe(2);
    expect(counts.NO_DEVICE).toBe(1);
    const sent = push.take();
    expect(sent.map((m) => m.token)).toContain(tokenVecina);
    const m = sent.find((x) => x.token === tokenVecina)!;
    expect(m).toMatchObject({ title: "Inundación en Miraflores, Lima", url: `dizaster://event/${eventId}`, groupKey: `event-${eventId}`, provider: "FCM" });
    expect(m.body).toContain("Corroborado por la comunidad");
    const v = await inbox(vecina);
    expect(v.notifications).toHaveLength(1);
    expect(v.notifications[0]).toMatchObject({ kind: "NEW_EVENT", match: "FOLLOWED_PLACE", eventId, delivery: "SENT", readAt: null });
    expect(v.unread).toBe(1);
    expect((await inbox(suscrita)).notifications[0]).toMatchObject({ match: "CATEGORY" });
    // Sin dispositivo con push: queda en el historial igualmente.
    expect((await inbox(sinDispositivo)).notifications[0]).toMatchObject({ delivery: "NO_DEVICE" });
  });

  it("nunca revela en la notificación quién reportó (seudónimo o no) ni coordenadas", async () => {
    const all = JSON.stringify([await inbox(vecina), await inbox(suscrita)]);
    const handles = (await t.c.db.query<{ handle: string; display_name: string }>(
      `SELECT handle, display_name FROM social.profiles WHERE id = ANY($1)`, [reporters.map((r) => r.profileId)],
    )).rows;
    for (const h of handles) {
      expect(all).not.toContain(h.handle);
      expect(all).not.toContain(h.display_name);
    }
    expect(all).not.toContain("reporte");
    expect(all).not.toMatch(/-12\.1|-77\.0/);
  });

  it("deduplica: más reportes y reevaluaciones del mismo EVENT no repiten el aviso", async () => {
    const extra = await createUser(t, "inund_extra");
    const r = await submit(t, extra, reportBody(extra, { category: "natural.flood", pin: offset(MIRAFLORES, 30) }));
    expect(r.body.eventId).toBe(eventId);
    await drain();
    await withTransaction(t.c.db, (tx) => t.c.alerts.evaluate(tx, eventId));
    await t.c.alerts.flush();
    expect(push.take()).toEqual([]);
    expect((await inbox(vecina)).notifications).toHaveLength(1);
  });

  it("un cambio importante de estado avisa a quien sigue el EVENT y a quien ya recibió aviso", async () => {
    const seguidor = await createUser(t, "seguidor_evento");
    await withDevice(seguidor);
    expect((await follow(seguidor, "event", eventId)).statusCode).toBe(200);
    await withTransaction(t.c.db, async (tx) => {
      await publish(tx, "VerificationChanged", { eventId, from: "COMMUNITY_CORROBORATED", to: "COMMUNITY_CORROBORATED", negativeState: "FALSE" });
    });
    await t.c.db.query(`UPDATE event.events SET negative_state = 'FALSE' WHERE id = $1`, [eventId]);
    await drain();
    await t.c.alerts.flush();
    const sent = push.take();
    expect(sent.map((m) => m.title)).toEqual(expect.arrayContaining(["Marcado como falso: Inundación"]));
    expect((await inbox(seguidor)).notifications[0]).toMatchObject({ kind: "STATE_CHANGED", match: "FOLLOWED_EVENT" });
    expect((await inbox(vecina)).notifications[0]).toMatchObject({ kind: "STATE_CHANGED", match: "PREVIOUSLY_ALERTED" });
  });

  it("historial: marcar como leído y paginar", async () => {
    const first = await inbox(vecina, "?limit=1");
    expect(first.nextCursor).not.toBeNull();
    const second = await inbox(vecina, `?limit=1&cursor=${first.nextCursor}`);
    expect(second.notifications[0]!.id).not.toBe(first.notifications[0]!.id);
    const one = await t.app.inject({ method: "POST", url: "/v1/me/notifications/read", headers: auth(vecina), payload: { ids: [first.notifications[0]!.id] } });
    expect(one.json()).toEqual({ unread: 1 });
    const all = await t.app.inject({ method: "POST", url: "/v1/me/notifications/read", headers: auth(vecina) });
    expect(all.json()).toEqual({ unread: 0 });
    expect((await t.app.inject({ url: "/v1/me/notifications" })).statusCode).toBe(401);
  });
});

describe("preferencias, límites y agrupación", () => {
  it("las preferencias filtran: sin lugares seguidos no llega el aviso", async () => {
    const u = await createUser(t, "pref_off");
    await withDevice(u);
    await follow(u, "place", "PE:070101");
    await setPrefs(u, { followedPlaces: false });
    await corroborated("fire.structure", CALLAO, "callao");
    await t.c.alerts.flush();
    push.take();
    expect((await inbox(u)).notifications).toEqual([]);
  });

  it("varias alertas a la vez se agrupan en un solo aviso y el límite por hora silencia el resto", async () => {
    const u = await createUser(t, "rafaga");
    const token = await withDevice(u);
    await setPrefs(u, { maxPerHour: 1 });
    await follow(u, "place", "PE:15");
    await corroborated("accident.traffic", offset(MIRAFLORES, 1500), "rafA");
    await corroborated("fire.vehicle", offset(MIRAFLORES, 3000), "rafB");
    await t.c.alerts.flush();
    const mine = push.take().filter((m) => m.token === token);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ title: "2 alertas nuevas", url: "dizaster://alerts", groupKey: "alerts-summary" });
    expect((await inbox(u)).notifications.map((n) => n.delivery)).toEqual(["GROUPED", "GROUPED"]);

    await corroborated("natural.landslide", offset(MIRAFLORES, 4500), "rafC");
    await t.c.alerts.flush();
    expect(push.take().filter((m) => m.token === token)).toEqual([]);
    expect((await inbox(u)).notifications[0]!.delivery).toBe("SILENT_RATE_LIMIT");
  });

  it("horas de silencio: queda en el historial; una confirmación oficial grave sí suena", async () => {
    const u = await createUser(t, "noche");
    const token = await withDevice(u);
    const now = new Date();
    const m = now.getUTCHours() * 60 + now.getUTCMinutes();
    await setPrefs(u, { quietHours: { start: (m + 1440 - 30) % 1440, end: (m + 30) % 1440 }, timezone: "UTC" });
    const sub = await t.app.inject({ method: "POST", url: "/v1/me/alert-subscriptions", headers: auth(u), payload: { categoryCode: "natural.earthquake", areaId: "PE", minSeverity: 4 } });
    expect(sub.statusCode).toBe(201);
    await follow(u, "place", "PE:070101");
    await corroborated("accident.industrial", offset(CALLAO, 800), "quiet");
    // Mar adentro frente a Arequipa: ningún país lo contiene, pero la suscripción a Perú debe cubrirlo.
    await t.c.ingestion.ingest("usgs-earthquakes", {
      externalId: "us-alert-1", categoryCode: "natural.earthquake", point: offset(MIRAFLORES, -500_000, 250_000), uncertaintyM: 5000,
      occurredAt: now.toISOString(), publishedAt: now.toISOString(), title: { es: "Sismo" }, severity: 5, assertion: "OCCURRING", raw: {},
    }, "URGENT");
    await drain();
    await t.c.alerts.flush();
    const mine = push.take().filter((x) => x.token === token);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ critical: true });
    expect(mine[0]!.title).toMatch(/^Sismo/);
    const deliveries = (await inbox(u)).notifications.map((n) => `${n.match}:${n.delivery}`).sort();
    expect(deliveries).toEqual(["CATEGORY:SENT", "FOLLOWED_PLACE:SILENT_QUIET_HOURS"]);
  });

  it("valida preferencias y suscripciones", async () => {
    const u = await createUser(t, "validar");
    expect((await t.app.inject({ method: "PUT", url: "/v1/me/alert-preferences", headers: auth(u), payload: { timezone: "Marte/Olimpo" } })).statusCode).toBe(400);
    expect((await t.app.inject({ method: "PUT", url: "/v1/me/alert-preferences", headers: auth(u), payload: { minSeverity: 9 } })).statusCode).toBe(400);
    const post = (payload: object) => t.app.inject({ method: "POST", url: "/v1/me/alert-subscriptions", headers: auth(u), payload });
    expect((await post({ categoryCode: "no.existe", areaId: "PE" })).statusCode).toBe(400);
    expect((await post({ categoryCode: "health", areaId: "PE:999999" })).statusCode).toBe(404);
    expect((await post({ categoryCode: "health", areaId: "ZZ" })).statusCode).toBe(400);
    const ok = (await post({ categoryCode: "health", areaId: "PE:150122" })).json() as CategorySubscription;
    expect(ok).toMatchObject({ categoryCode: "health", areaName: "Miraflores, Lima", minSeverity: 3 });
    const list = (await t.app.inject({ url: "/v1/me/alert-subscriptions", headers: auth(u) })).json();
    expect(list.subscriptions).toHaveLength(1);
    expect((await t.app.inject({ method: "DELETE", url: `/v1/me/alert-subscriptions/${ok.id}`, headers: auth(u) })).statusCode).toBe(204);
    expect((await t.app.inject({ url: "/v1/me/alert-preferences", headers: auth(u) })).json()).toMatchObject({ enabled: true, minSeverity: 3, maxPerHour: 6 });
  });
});

describe("privacidad y mantenimiento", () => {
  it("un evento muy sensible no avisa a quien sigue el distrito (el distrito no se publica), sí a la región sin distrito", async () => {
    const distrito = await createUser(t, "sigue_distrito");
    const region = await createUser(t, "sigue_region");
    await follow(distrito, "place", "PE:150122");
    await follow(region, "place", "PE:15");
    await setPrefs(region, { minSeverity: 1 });
    await corroborated("crime.violence", offset(MIRAFLORES, 200), "violencia");
    await t.c.alerts.flush();
    push.take();
    const titles = (await inbox(distrito)).notifications.map((n) => n.title);
    expect(titles.some((x) => x.startsWith("Violencia"))).toBe(false);
    const r = (await inbox(region)).notifications.find((n) => n.categoryCode === "crime.violence");
    expect(r?.title).not.toContain("Miraflores");
  });

  it("un token que el proveedor rechaza se olvida y la entrega queda como FAILED", async () => {
    const u = await createUser(t, "token_viejo");
    const token = await withDevice(u);
    push.invalid.add(token);
    await follow(u, "place", "PE:070101");
    await corroborated("infra.gas_leak", offset(CALLAO, 1200), "gas");
    await t.c.alerts.flush();
    push.take();
    expect((await inbox(u)).notifications[0]!.delivery).toBe("FAILED");
    const dev = (await t.c.db.query(`SELECT push_token FROM identity.devices WHERE id = $1`, [u.deviceId])).rows[0];
    expect(dev.push_token).toBeNull();
  });

  it("cuando el EVENT termina, avisa a quien ya había recibido aviso", async () => {
    const u = await createUser(t, "fin");
    await follow(u, "place", "PE:070101");
    const { eventId } = await corroborated("infra.bridge_damage", offset(CALLAO, 2500), "puente");
    await t.c.alerts.flush();
    await t.c.events.applyLifecycle(t.c.db, new Date(Date.now() + 30 * 24 * 3600_000));
    await drain();
    await t.c.alerts.flush();
    const mine = (await inbox(u)).notifications.filter((n) => n.eventId === eventId);
    expect(mine.map((n) => n.kind)).toEqual(["RESOLVED", "NEW_EVENT"]);
  });
});

describe("Alert Engine: zonas guardadas y cerca de mí (D-16)", () => {
  const CHORRILLOS = { lat: -12.1686, lng: -77.0247 };
  const zone = (u: TestUser, payload: object) => t.app.inject({ method: "POST", url: "/v1/me/zones", headers: auth(u), payload });

  it("guarda zonas generalizadas, con límite, y solo las ve su dueña", async () => {
    const u = await createUser(t, "zonas");
    const otra = await createUser(t, "zonas_otra");
    const res = await zone(u, { kind: "HOME", name: "Casa", lat: -12.16861, lng: -77.02471, radiusKm: 2 });
    expect(res.statusCode, res.body).toBe(201);
    const z = res.json();
    // El punto guardado es el centro de una celda r8, no el que se envió.
    expect(z.center).not.toEqual({ lat: -12.16861, lng: -77.02471 });
    expect(Math.abs(z.center.lat - -12.16861)).toBeLessThan(0.01);
    expect((await zone(u, { kind: "NOPE", lat: 0, lng: 0 })).statusCode).toBe(400);
    expect((await zone(u, { kind: "WORK", lat: 0, lng: 0, radiusKm: 80 })).statusCode).toBe(400);
    for (let i = 0; i < 4; i++) expect((await zone(u, { kind: "OTHER", lat: i, lng: i })).statusCode).toBe(201);
    expect((await zone(u, { kind: "OTHER", lat: 9, lng: 9 })).statusCode).toBe(409);

    const edit = await t.app.inject({ method: "PUT", url: `/v1/me/zones/${z.id}`, headers: auth(u), payload: { kind: "HOME", lat: -12.1686, lng: -77.0247, radiusKm: 5 } });
    expect(edit.json()).toMatchObject({ radiusKm: 5, name: null });
    expect((await t.app.inject({ method: "PUT", url: `/v1/me/zones/${z.id}`, headers: auth(otra), payload: { kind: "HOME", lat: 0, lng: 0 } })).statusCode).toBe(404);
    expect((await t.app.inject({ url: "/v1/me/zones", headers: auth(otra) })).json().zones).toEqual([]);
    await t.app.inject({ method: "DELETE", url: `/v1/me/zones/${z.id}`, headers: auth(otra) });
    expect((await t.app.inject({ url: "/v1/me/zones", headers: auth(u) })).json().zones).toHaveLength(5);
  });

  it("'cerca de mí' solo guarda la ubicación si está activado, y apagarlo la borra", async () => {
    const u = await createUser(t, "cerca_off");
    const put = () => t.app.inject({ method: "PUT", url: "/v1/me/approximate-location", headers: auth(u), payload: offset(CHORRILLOS, 300) });
    expect((await put()).json()).toEqual({ stored: false });
    await setPrefs(u, { nearMe: true });
    expect((await put()).json()).toEqual({ stored: true });
    const row = (await t.c.db.query<{ lat: number }>(`SELECT ST_Y(center::geometry) AS lat FROM alert.last_locations WHERE profile_id = $1`, [u.profileId])).rows[0]!;
    expect(row.lat).not.toBeCloseTo(offset(CHORRILLOS, 300).lat, 6);
    await setPrefs(u, { nearMe: false });
    expect((await t.c.db.query(`SELECT 1 FROM alert.last_locations WHERE profile_id = $1`, [u.profileId])).rowCount).toBe(0);
  });

  it("avisa por zona guardada y por cercanía; lo lejano, lo caducado o lo desactivado no", async () => {
    const enZona = await createUser(t, "en_zona");
    const cerca = await createUser(t, "cerca_si");
    const caducada = await createUser(t, "cerca_vieja");
    const lejos = await createUser(t, "lejos");
    const sinZonas = await createUser(t, "sin_zonas");
    expect((await zone(enZona, { kind: "FAMILY", lat: CHORRILLOS.lat, lng: CHORRILLOS.lng, radiusKm: 5 })).statusCode).toBe(201);
    expect((await zone(sinZonas, { kind: "HOME", lat: CHORRILLOS.lat, lng: CHORRILLOS.lng, radiusKm: 5 })).statusCode).toBe(201);
    await setPrefs(sinZonas, { savedZones: false });
    expect((await zone(lejos, { kind: "WORK", lat: CALLAO.lat, lng: CALLAO.lng, radiusKm: 2 })).statusCode).toBe(201);
    for (const u of [cerca, caducada]) {
      await setPrefs(u, { nearMe: true });
      await t.app.inject({ method: "PUT", url: "/v1/me/approximate-location", headers: auth(u), payload: offset(CHORRILLOS, 4000) });
    }
    await t.c.db.query(`UPDATE alert.last_locations SET seen_at = now() - interval '4 days' WHERE profile_id = $1`, [caducada.profileId]);

    const { eventId } = await corroborated("fire.structure", CHORRILLOS, "chorri");
    const got = async (u: TestUser) => (await inbox(u)).notifications.filter((n) => n.eventId === eventId);
    expect((await got(enZona)).map((n) => n.match)).toEqual(["SAVED_ZONE"]);
    expect((await got(cerca)).map((n) => n.match)).toEqual(["NEAR_ME"]);
    expect(await got(caducada)).toEqual([]);
    expect(await got(lejos)).toEqual([]);
    expect(await got(sinZonas)).toEqual([]);
    // El texto no menciona la zona ni su nombre privado.
    expect((await got(enZona))[0]!.title).not.toMatch(/FAMILY|familia/i);
  });

  it("cada zona filtra por gravedad mínima y categorías (ADR 0154)", async () => {
    const SURCO = { lat: -12.145, lng: -76.99 };
    const todas = await createUser(t, "zona_todas");
    const soloFuego = await createUser(t, "zona_fuego");
    const soloAccidentes = await createUser(t, "zona_accidentes");
    const soloGraves = await createUser(t, "zona_graves");
    const base = { kind: "HOME", lat: SURCO.lat, lng: SURCO.lng, radiusKm: 5 };
    expect((await zone(soloFuego, { ...base, categories: ["no.existe"] })).statusCode).toBe(400);
    expect((await zone(soloFuego, { ...base, minSeverity: 9 })).statusCode).toBe(400);
    expect((await zone(todas, base)).json()).toMatchObject({ minSeverity: 1, categories: [] });
    expect((await zone(soloFuego, { ...base, categories: ["fire", "fire"] })).json()).toMatchObject({ categories: ["fire"] });
    await zone(soloAccidentes, { ...base, categories: ["accident"] });
    await zone(soloGraves, { ...base, minSeverity: 5 });

    const { eventId } = await corroborated("fire.structure", SURCO, "surco");
    const severity = (await t.c.db.query<{ severity: number }>(`SELECT severity FROM event.events WHERE id = $1`, [eventId])).rows[0]!.severity;
    expect(severity).toBeLessThan(5);
    const got = async (u: TestUser) => (await inbox(u)).notifications.filter((n) => n.eventId === eventId).map((n) => n.match);
    expect(await got(todas)).toEqual(["SAVED_ZONE"]);
    expect(await got(soloFuego)).toEqual(["SAVED_ZONE"]);
    expect(await got(soloAccidentes)).toEqual([]);
    expect(await got(soloGraves)).toEqual([]);
  });
});
