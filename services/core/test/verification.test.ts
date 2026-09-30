import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NormalizedItem } from "../src/modules/ingestion/index.js";
import { actAsOfficial, LIMA, createTestContext, createUser, offset, reportBody, submit, type TestContext } from "./helpers.js";

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
  await t.c.ingestion.setSourceStatus("usgs-earthquakes", "ACTIVE");
  await actAsOfficial(t, "usgs-earthquakes");
  await t.c.ingestion.setSourceStatus("nasa-firms", "ACTIVE");
});
afterAll(async () => { await t.close(); });

const verification = async (eventId: string) => (await t.app.inject({ url: `/v1/events/${eventId}/verification` })).json();
const drain = () => t.c.dispatcher.drain();

function item(externalId: string, point: { lat: number; lng: number }, over: Partial<NormalizedItem> = {}): NormalizedItem {
  return {
    externalId, categoryCode: "fire.wildfire", point, uncertaintyM: 375, occurredAt: new Date().toISOString(),
    publishedAt: new Date().toISOString(), title: { es: "Foco de calor" }, severity: 3, assertion: "OCCURRING", raw: {}, ...over,
  };
}

describe("Verification Engine", () => {
  it("COMMUNITY_CORROBORATED con 3 personas independientes y presencia alta", async () => {
    const pin = offset(LIMA, 0, 60000);
    const [a, b, c] = await Promise.all(["v1", "v2", "v3"].map((h) => createUser(t, h)));
    const r1 = await submit(t, a!, reportBody(a!, { pin }));
    await submit(t, b!, reportBody(b!, { pin: offset(pin, 20) }));
    await drain();
    expect((await verification(r1.body.eventId!)).level).toBe("UNVERIFIED");
    await submit(t, c!, reportBody(c!, { pin: offset(pin, -20) }));
    await drain();
    const v = await verification(r1.body.eventId!);
    expect(v).toMatchObject({ level: "COMMUNITY_CORROBORATED", publicState: "COMMUNITY_CORROBORATED", negativeState: "NONE" });
    const ev = (await t.app.inject({ url: `/v1/events/${r1.body.eventId}` })).json();
    expect(ev.verificationLevel).toBe("COMMUNITY_CORROBORATED");
  });

  it("cuentas recién creadas pesan la mitad (anti granjas de cuentas)", async () => {
    const pin = offset(LIMA, 0, 70000);
    const users = await Promise.all(["n1", "n2", "n3"].map((h) => createUser(t, h, 1)));
    let eventId = "";
    for (const u of users) eventId = (await submit(t, u, reportBody(u, { pin }))).body.eventId!;
    await drain();
    expect((await verification(eventId)).level).toBe("UNVERIFIED");
  });

  it("reportes con el mismo texto copiado cuentan como uno (ADR 0074)", async () => {
    const pin = offset(LIMA, 0, 90000);
    const users = await Promise.all(["copia1", "copia2", "copia3"].map((h) => createUser(t, h)));
    const texts = ["Choque grave en la avenida, hay heridos!", "choque grave en la AVENIDA hay heridos", "Choque grave en la avenida — hay heridos."];
    let eventId = "";
    for (const [i, u] of users.entries()) eventId = (await submit(t, u, reportBody(u, { pin: offset(pin, i * 15), text: texts[i] }))).body.eventId!;
    await drain();
    expect((await verification(eventId)).level).toBe("UNVERIFIED");
    // Textos cortos iguales son normales entre testigos reales y no se agrupan.
    const pin2 = offset(LIMA, 0, 100000);
    const others = await Promise.all(["corto1", "corto2", "corto3"].map((h) => createUser(t, h)));
    for (const [i, u] of others.entries()) eventId = (await submit(t, u, reportBody(u, { pin: offset(pin2, i * 15), text: "Hay humo" }))).body.eventId!;
    await drain();
    expect((await verification(eventId)).level).toBe("COMMUNITY_CORROBORATED");
  });

  it("solo cuentan juntos los reportes dentro de una ventana de tiempo coherente (ADR 0081)", async () => {
    const pin = offset(LIMA, 0, 110000);
    const [a, b, c] = await Promise.all(["vent1", "vent2", "vent3"].map((h) => createUser(t, h)));
    const r1 = await submit(t, a!, reportBody(a!, { pin }));
    await submit(t, b!, reportBody(b!, { pin: offset(pin, 20) }));
    // Los dos primeros quedan dos días antes: fuera de la ventana de la categoría respecto del tercero.
    await t.c.db.query(`UPDATE event.evidence SET observed_at = observed_at - interval '2 days' WHERE event_id = $1`, [r1.body.eventId]);
    await submit(t, c!, reportBody(c!, { pin: offset(pin, -20) }));
    await drain();
    const v = await verification(r1.body.eventId!);
    expect(v.level).toBe("UNVERIFIED");
  });

  it("la misma persona reportando varias veces cuenta una sola vez", async () => {
    const pin = offset(LIMA, 0, 80000);
    const u = await createUser(t, "insistente");
    let eventId = "";
    for (let i = 0; i < 3; i++) eventId = (await submit(t, u, reportBody(u, { pin: offset(pin, i * 10) }))).body.eventId!;
    await drain();
    expect((await verification(eventId)).level).toBe("UNVERIFIED");
  });

  it("fuente externa registrada → EXTERNALLY_CORROBORATED; fuente oficial → OFFICIALLY_CONFIRMED", async () => {
    const pin = offset(LIMA, 50000, 50000);
    const u = await createUser(t, "bosque");
    const r = await submit(t, u, reportBody(u, { pin, category: "fire.wildfire" }));
    const ext = await t.c.ingestion.ingest("nasa-firms", item("firms-1", offset(pin, 300)), "URGENT");
    expect(ext.resolution).toMatchObject({ kind: "ATTACHED", eventId: r.body.eventId });
    await drain();
    expect((await verification(r.body.eventId!)).level).toBe("EXTERNALLY_CORROBORATED");

    // Reutilizamos la fuente oficial USGS con categoría de sismo sobre un evento de sismo.
    const quake = await t.c.ingestion.ingest("usgs-earthquakes", item("us7000abcd", offset(LIMA, -150000), { categoryCode: "natural.earthquake", severity: 4 }), "URGENT");
    expect(quake.resolution?.kind).toBe("CREATED");
    await drain();
    const eventId = (quake.resolution as { eventId: string }).eventId;
    const v = await verification(eventId);
    expect(v.level).toBe("OFFICIALLY_CONFIRMED");
    const { rows } = await t.c.db.query(`SELECT cause, cardinality(evidence_ids) AS n FROM verification.transitions WHERE event_id = $1`, [eventId]);
    expect(rows).toEqual([{ cause: "OFFICIAL_SOURCE", n: 1 }]);
  });

  it("la ingestión es idempotente por (fuente, id externo)", async () => {
    const again = await t.c.ingestion.ingest("nasa-firms", item("firms-1", offset(offset(LIMA, 50000, 50000), 300)), "URGENT");
    // Mismo contenido salvo marcas de tiempo → se trata como actualización, sin evidencia duplicada.
    expect(again.resolution === null || again.resolution.kind === "ATTACHED").toBe(true);
    const { rows } = await t.c.db.query(`SELECT count(*)::int AS n FROM ingestion.external_items WHERE external_id = 'firms-1'`);
    expect(rows[0].n).toBe(1);
  });

  it("una fuente no activa (en investigación) no puede ingerir", async () => {
    await expect(t.c.ingestion.ingest("pe-igp-sismos", item("x", LIMA, { categoryCode: "natural.earthquake" }), "URGENT")).rejects.toThrow(/no está activa/);
  });
});

describe("la IA no puede producir OFFICIALLY_CONFIRMED", () => {
  it("el servicio rechaza la sugerencia", async () => {
    const { rows } = await t.c.db.query(`SELECT id FROM event.events LIMIT 1`);
    await expect(
      t.c.verification.recordAiSuggestion({ eventId: rows[0].id, task: "dedup", suggestedLevel: "OFFICIALLY_CONFIRMED", rationale: "x", provider: "p", model: "m" }),
    ).rejects.toThrow(/IA no puede/);
  });

  it("tampoco FALSE: ni el servicio ni la base de datos lo aceptan (ADR 0231)", async () => {
    const { rows } = await t.c.db.query(`SELECT id FROM event.events LIMIT 1`);
    await expect(
      t.c.verification.recordAiSuggestion({ eventId: rows[0].id, task: "dedup", suggestedNegative: "FALSE", rationale: "x", provider: "p", model: "m" }),
    ).rejects.toThrow(/IA no puede proponer FALSE/);
    await expect(
      t.c.db.query(`INSERT INTO verification.ai_suggestions (id, event_id, task, suggested_negative, provider, model) VALUES (gen_random_uuid(), $1, 't', 'FALSE', 'p', 'm')`, [rows[0].id]),
    ).rejects.toThrow(/ai_never_false/);
  });

  it("la base de datos también lo impide (defensa en profundidad)", async () => {
    const { rows } = await t.c.db.query(`SELECT event_id FROM verification.state WHERE level = 'UNVERIFIED' LIMIT 1`);
    const eventId = rows[0].event_id;
    await expect(
      t.c.db.query(`INSERT INTO verification.ai_suggestions (id, event_id, task, suggested_level, provider, model) VALUES (gen_random_uuid(), $1, 't', 'OFFICIALLY_CONFIRMED', 'p', 'm')`, [eventId]),
    ).rejects.toThrow();
    await expect(
      t.c.db.query(
        `INSERT INTO verification.transitions (id, event_id, from_level, to_level, from_negative, to_negative, cause, evidence_ids, actor)
         VALUES (gen_random_uuid(), $1, 'UNVERIFIED', 'OFFICIALLY_CONFIRMED', 'NONE', 'NONE', 'RULE', '{}', 'x')`,
        [eventId],
      ),
    ).rejects.toThrow(/official_confirmation_requires_official_source/);
    await expect(
      t.c.db.query(
        `INSERT INTO verification.transitions (id, event_id, from_level, to_level, from_negative, to_negative, cause, evidence_ids, actor)
         VALUES (gen_random_uuid(), $1, 'UNVERIFIED', 'OFFICIALLY_CONFIRMED', 'NONE', 'NONE', 'MODERATOR', ARRAY[gen_random_uuid()], 'x')`,
        [eventId],
      ),
    ).rejects.toThrow(/official_confirmation_requires_official_source/);
  });
});

describe("estados negativos: DISPUTED y FALSE", () => {
  let eventId = "";
  const pin = offset(LIMA, -60000, -20000);

  it("DISPUTED cuando personas presentes niegan el evento; se levanta si las confirmaciones lo superan", async () => {
    const [a, b, c, d] = await Promise.all(["d1", "d2", "d3", "d4"].map((h) => createUser(t, h)));
    eventId = (await submit(t, a!, reportBody(a!, { pin, category: "infra.road_blocked" }))).body.eventId!;
    for (const u of [b!, c!]) {
      const r = await submit(t, u, reportBody(u, { pin: offset(pin, 15), category: "infra.road_blocked", assertion: "NOT_OCCURRING", targetEventId: eventId }));
      expect(r.body.outcome).toBe("ATTACHED_TO_EVENT");
    }
    await drain();
    expect((await verification(eventId)).publicState).toBe("DISPUTED");
    const others = await Promise.all(["d5", "d6", "d7"].map((h) => createUser(t, h)));
    for (const u of [d!, ...others]) await submit(t, u, reportBody(u, { pin: offset(pin, -10), category: "infra.road_blocked" }));
    await drain();
    const v = await verification(eventId);
    expect(v.negativeState).toBe("NONE");
    expect(v.level).toBe("COMMUNITY_CORROBORATED");
  });

  it("un contra-reporte sin evento indicado es inválido y nunca crea eventos", async () => {
    const u = await createUser(t, "negador");
    const body = reportBody(u, { pin, category: "infra.road_blocked", assertion: "NOT_OCCURRING" });
    const r = await submit(t, u, body);
    expect(r.status).toBe(400);
  });

  it("la moderación exige motivo y evidencia para FALSE, y requiere el rol", async () => {
    const user = await createUser(t, "curioso");
    const denied = await t.app.inject({
      method: "POST", url: `/v1/moderation/events/${eventId}/negative-state`, headers: { authorization: `Bearer ${user.token}` },
      payload: { to: "FALSE", reason: "Motivo suficientemente largo", evidenceRefs: [eventId] },
    });
    expect(denied.statusCode).toBe(403);

    await expect(t.c.verification.moderatorSetNegative({ eventId, moderatorUserId: user.userId, to: "FALSE", reason: "corto", evidenceRefs: [eventId] })).rejects.toThrow(/motivo/);
    await expect(t.c.verification.moderatorSetNegative({ eventId, moderatorUserId: user.userId, to: "FALSE", reason: "Montaje comprobado con fotos antiguas", evidenceRefs: [] })).rejects.toThrow(/evidencia/);

    await t.c.identity.grantRole(user.userId, "moderator");
    const session = await t.c.identity.signIn("DEV", "curioso", "curioso");
    const token = await t.c.identity.issueToken(session);
    const ok = await t.app.inject({
      method: "POST", url: `/v1/moderation/events/${eventId}/negative-state`, headers: { authorization: `Bearer ${token}` },
      payload: { to: "FALSE", reason: "Montaje comprobado con fotos antiguas", evidenceRefs: [eventId] },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().publicState).toBe("FALSE");
    await drain();
    // Un evento FALSE desaparece del mapa pero sigue accesible por enlace con su estado.
    const bbox = `${pin.lng - 0.01},${pin.lat - 0.01},${pin.lng + 0.01},${pin.lat + 0.01}`;
    expect((await t.app.inject({ url: `/v1/events?bbox=${bbox}&zoom=15` })).json().events).toHaveLength(0);
    expect((await t.app.inject({ url: `/v1/events/${eventId}` })).json().publicVerificationState).toBe("FALSE");
    const { rows } = await t.c.db.query(`SELECT cause, actor, reason FROM verification.transitions WHERE event_id = $1 AND to_negative = 'FALSE'`, [eventId]);
    expect(rows[0]).toMatchObject({ cause: "MODERATOR", reason: "Montaje comprobado con fotos antiguas" });
  });

  it("nuevas confirmaciones ciudadanas no revierten un FALSE", async () => {
    const u = await createUser(t, "d8");
    await submit(t, u, reportBody(u, { pin, category: "infra.road_blocked", targetEventId: eventId }));
    await drain();
    expect((await verification(eventId)).negativeState).toBe("FALSE");
  });

  it("un evento confirmado oficialmente solo lo desmiente una fuente oficial", async () => {
    const quakePoint = offset(LIMA, -300000);
    const created = await t.c.ingestion.ingest("usgs-earthquakes", item("us-deny-1", quakePoint, { categoryCode: "natural.earthquake" }), "URGENT");
    await drain();
    const quakeId = (created.resolution as { eventId: string }).eventId;
    const mod = await createUser(t, "moderadora");
    await expect(
      t.c.verification.moderatorSetNegative({ eventId: quakeId, moderatorUserId: mod.userId, to: "FALSE", reason: "No me parece real", evidenceRefs: [quakeId] }),
    ).rejects.toThrow(/fuente oficial/);

    await t.c.ingestion.ingest("usgs-earthquakes", item("us-deny-1-retraction", offset(quakePoint, 500), { categoryCode: "natural.earthquake", assertion: "NOT_OCCURRING" }), "URGENT");
    await drain();
    const v = await verification(quakeId);
    expect(v).toMatchObject({ level: "OFFICIALLY_CONFIRMED", negativeState: "FALSE", publicState: "FALSE" });
    const { rows } = await t.c.db.query(`SELECT cause FROM verification.transitions WHERE event_id = $1 AND to_negative = 'FALSE'`, [quakeId]);
    expect(rows[0].cause).toBe("OFFICIAL_SOURCE");
  });
});
