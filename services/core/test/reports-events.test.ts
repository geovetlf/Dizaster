import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LIMA, createTestContext, createUser, offset, reportBody, submit, type TestContext } from "./helpers.js";

let t: TestContext;
beforeAll(async () => { t = await createTestContext(); });
afterAll(async () => { await t.close(); });

describe("Report Engine + Event Engine", () => {
  it("cuatro personas reportan el mismo accidente → un EVENT con cuatro REPORTS", async () => {
    const users = await Promise.all(["ana", "beto", "carla", "dario"].map((h) => createUser(t, h)));
    const results = [];
    for (const [i, u] of users.entries()) {
      results.push(await submit(t, u, reportBody(u, { pin: offset(LIMA, i * 40, i * 25), text: "Choque en la Av. Abancay" })));
    }
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect(results[0]!.body.outcome).toBe("CREATED_EVENT");
    for (const r of results.slice(1)) expect(r.body.outcome).toBe("ATTACHED_TO_EVENT");
    const eventIds = new Set(results.map((r) => r.body.eventId));
    expect(eventIds.size).toBe(1);

    const ev = await t.app.inject({ url: `/v1/events/${results[0]!.body.eventId}` });
    expect(ev.json()).toMatchObject({ reportCount: 4, categoryCode: "accident.traffic", countryCode: "PE", publicationState: "PUBLISHED" });
  });

  it("un reporte a 5 km crea otro evento", async () => {
    const u = await createUser(t, "lejano");
    const r = await submit(t, u, reportBody(u, { pin: offset(LIMA, 5000) }));
    expect(r.body.outcome).toBe("CREATED_EVENT");
  });

  it("sin presencia física (pin a 3 km del GPS) se degrada a POST sin pin", async () => {
    const u = await createUser(t, "remoto");
    const r = await submit(t, u, reportBody(u, { pin: offset(LIMA, 3000), fix: LIMA }));
    expect(r.body).toMatchObject({ outcome: "DOWNGRADED_TO_POST" });
    expect(r.body["reasons"]).toContain("OUT_OF_RADIUS");
    const { rows } = await t.c.db.query(`SELECT kind, public_point FROM social.posts WHERE id = $1`, [r.body.postId]);
    expect(rows[0]).toMatchObject({ kind: "STANDARD", public_point: null });
  });

  it("ubicación simulada nunca crea un pin", async () => {
    const u = await createUser(t, "falsario");
    const r = await submit(t, u, reportBody(u, { pin: offset(LIMA, 9000), mock: true }));
    expect(r.body.outcome).toBe("DOWNGRADED_TO_POST");
  });

  it("el reintento offline es idempotente", async () => {
    const u = await createUser(t, "reintento");
    const body = reportBody(u, { pin: offset(LIMA, 12000) });
    const a = await submit(t, u, body);
    const b = await submit(t, u, body);
    expect(b.body).toEqual(a.body);
    const { rows } = await t.c.db.query(`SELECT count(*)::int AS n FROM report.reports WHERE author_user_id = $1`, [u.userId]);
    expect(rows[0].n).toBe(1);
  });

  it("presencia media crea un evento PENDIENTE que no aparece en el mapa hasta que otra persona lo respalda", async () => {
    const a = await createUser(t, "media1");
    const b = await createUser(t, "media2");
    const pin = offset(LIMA, -8000);
    const r1 = await submit(t, a, reportBody(a, { pin, attestation: null, category: "fire.structure" }));
    expect(r1.body).toMatchObject({ outcome: "CREATED_EVENT", presenceBand: "MEDIUM" });
    const bbox = `${pin.lng - 0.01},${pin.lat - 0.01},${pin.lng + 0.01},${pin.lat + 0.01}`;
    const before = await t.app.inject({ url: `/v1/events?bbox=${bbox}&zoom=15` });
    expect(before.json().events).toHaveLength(0);

    const r2 = await submit(t, b, reportBody(b, { pin: offset(pin, 30), category: "fire.structure" }));
    expect(r2.body).toMatchObject({ outcome: "ATTACHED_TO_EVENT", eventId: r1.body.eventId });
    const after = await t.app.inject({ url: `/v1/events?bbox=${bbox}&zoom=15` });
    expect(after.json().events.map((e: { id: string }) => e.id)).toContain(r1.body.eventId);
  });

  it("una categoría solo oficial (brote) no acepta reportes ciudadanos", async () => {
    const u = await createUser(t, "brote");
    const r = await submit(t, u, reportBody(u, { category: "health.outbreak" }));
    expect(r.status).toBe(422);
    expect(r.body.outcome).toBe("REJECTED");
  });

  it("un reporte offline tardío solo se suma a un evento existente; si no hay, queda como post", async () => {
    const u = await createUser(t, "offline");
    const capturedAt = new Date(Date.now() - 3 * 3600_000); // accidente: tolerancia 60 min
    const r = await submit(t, u, reportBody(u, { pin: offset(LIMA, 20000), capturedAt, capturedOffline: true }));
    expect(r.body).toMatchObject({ outcome: "DOWNGRADED_TO_POST" });
    expect(r.body["reasons"]).toContain("LATE_OFFLINE_SUBMISSION");
  });

  it("límite de reportes por hora (anti-abuso y costo)", async () => {
    const u = await createUser(t, "spammer");
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await submit(t, u, reportBody(u, { pin: offset(LIMA, 30000 + i * 3000) }))).status);
    expect(statuses.slice(0, 5).every((s) => s === 200)).toBe(true);
    expect(statuses[5]).toBe(429);
  });
});

describe("privacidad", () => {
  it("la API pública nunca devuelve la ubicación exacta del reportero", async () => {
    const u = await createUser(t, "privado");
    const pin = offset(LIMA, 40000, 123);
    const r = await submit(t, u, reportBody(u, { pin }));
    const res = await t.app.inject({ url: `/v1/events/${r.body.eventId}` });
    const body = res.json();
    expect(body.point).not.toEqual(pin);
    const text = res.body;
    expect(text).not.toContain(String(pin.lat));
    expect(text).not.toContain(u.userId);
    const tl = await t.app.inject({ url: `/v1/events/${r.body.eventId}/timeline` });
    expect(tl.body).not.toContain(u.userId);
  });

  it("las categorías sensibles generalizan a ~1 km² y fuerzan publicación seudónima", async () => {
    const u = await createUser(t, "victima");
    const pin = offset(LIMA, -40000);
    const r = await submit(t, u, reportBody(u, { pin, category: "crime.robbery" }));
    const ev = (await t.app.inject({ url: `/v1/events/${r.body.eventId}` })).json();
    expect(ev.sensitivity).toBe("SENSITIVE");
    const post = await t.c.social.getPost(t.c.db, r.body.postId!);
    expect(post.author).toEqual({ pseudonymous: true });
  });

  it("la evidencia de presencia se generaliza al vencer la retención", async () => {
    const future = new Date(Date.now() + 31 * 24 * 3600_000);
    const n = await t.c.reports.generalizeExpiredPresence(future);
    expect(n).toBeGreaterThan(0);
    const { rows } = await t.c.db.query(`SELECT count(*)::int AS n FROM report.presence_evidence WHERE device_fix IS NOT NULL OR device_fix_enc IS NOT NULL`);
    expect(rows[0].n).toBe(0);
  });
});

describe("mapa", () => {
  it("devuelve clusters en zoom bajo y puntos en zoom alto", async () => {
    const bbox = "-78,-13,-76,-11";
    const low = (await t.app.inject({ url: `/v1/events?bbox=${bbox}&zoom=6` })).json();
    expect(low.mode).toBe("clusters");
    expect(low.clusters.reduce((s: number, c: { count: number }) => s + c.count, 0)).toBeGreaterThan(0);
    const high = (await t.app.inject({ url: `/v1/events?bbox=${bbox}&zoom=14` })).json();
    expect(high.mode).toBe("points");
  });

  it("valida el bbox", async () => {
    const res = await t.app.inject({ url: `/v1/events?bbox=10,10,0,0&zoom=14` });
    expect(res.statusCode).toBe(400);
  });
});

describe("¿es este el mismo evento?", () => {
  it("sugiere el evento cercano compatible y el reporte elegido se suma a él", async () => {
    const pin = offset(LIMA, 70000, 70000);
    const a = await createUser(t, "cercano1");
    const b = await createUser(t, "cercano2");
    const r1 = await submit(t, a, reportBody(a, { pin, category: "infra.road_blocked" }));
    const near = offset(pin, 200);
    const res = await t.app.inject({ url: `/v1/events/nearby?lat=${near.lat}&lng=${near.lng}&category=accident.traffic`, headers: { authorization: `Bearer ${b.token}` } });
    const events = res.json().events as Array<{ id: string; distanceBucket: string; point: { lat: number } }>;
    expect(events[0]).toMatchObject({ id: r1.body.eventId, distanceBucket: "<500m" });
    expect(res.body).not.toContain(String(pin.lat));
    const r2 = await submit(t, b, reportBody(b, { pin: near, category: "accident.traffic", targetEventId: r1.body.eventId! }));
    expect(r2.body).toMatchObject({ outcome: "ATTACHED_TO_EVENT", eventId: r1.body.eventId });
  });

  it("requiere sesión", async () => {
    expect((await t.app.inject({ url: `/v1/events/nearby?lat=0&lng=0&category=fire.structure` })).statusCode).toBe(401);
  });

  it("no ofrece eventos incompatibles ni lejanos", async () => {
    const u = await createUser(t, "cercano3");
    const p = offset(LIMA, 70000, 70000);
    const res = await t.app.inject({ url: `/v1/events/nearby?lat=${p.lat}&lng=${p.lng}&category=fire.structure`, headers: { authorization: `Bearer ${u.token}` } });
    expect(res.json().events).toEqual([]);
  });
});

describe("ciclo de vida", () => {
  it("un evento sin actividad pasa a MONITORING y luego a RESOLVED, con registro en la timeline", async () => {
    const u = await createUser(t, "ciclo");
    const r = await submit(t, u, reportBody(u, { pin: offset(LIMA, -90000) }));
    const inFiveHours = new Date(Date.now() + 5 * 3600_000); // accidente: ventana 120 min → monitoreo a las 4 h
    await t.c.events.applyLifecycle(t.c.db, inFiveHours);
    expect((await t.app.inject({ url: `/v1/events/${r.body.eventId}` })).json().status).toBe("MONITORING");
    await t.c.events.applyLifecycle(t.c.db, new Date(Date.now() + 25 * 3600_000));
    expect((await t.app.inject({ url: `/v1/events/${r.body.eventId}` })).json().status).toBe("RESOLVED");
    const tl = (await t.app.inject({ url: `/v1/events/${r.body.eventId}/timeline` })).json().entries as Array<{ type: string }>;
    expect(tl.filter((e) => e.type === "STATUS_CHANGED")).toHaveLength(2);
  });

  it("un evento en seguimiento vuelve a activo cuando llega un reporte nuevo (ADR 0215)", async () => {
    const [u, v] = [await createUser(t, "ciclo_a"), await createUser(t, "ciclo_b")];
    const pin = offset(LIMA, -95000);
    const r = await submit(t, u, reportBody(u, { pin }));
    const eventId = r.body.eventId!;
    // Solo se adelanta el reloj del ciclo: la última actividad sigue siendo la del primer reporte.
    await t.c.events.applyLifecycle(t.c.db, new Date(Date.now() + 5 * 3600_000));
    expect((await t.app.inject({ url: `/v1/events/${eventId}` })).json().status).toBe("MONITORING");
    await new Promise((res) => setTimeout(res, 20));
    const r2 = await submit(t, v, reportBody(v, { pin: offset(pin, 30), targetEventId: eventId }));
    expect(r2.body.eventId).toBe(eventId);
    expect((await t.app.inject({ url: `/v1/events/${eventId}` })).json().status).toBe("ACTIVE");
    const tl = (await t.app.inject({ url: `/v1/events/${eventId}/timeline` })).json().entries as Array<{ type: string; payload: { cause?: string } }>;
    expect(tl.filter((e) => e.type === "STATUS_CHANGED").map((e) => e.payload.cause)).toEqual(expect.arrayContaining(["INACTIVITY", "NEW_ACTIVITY"]));
  });
});
