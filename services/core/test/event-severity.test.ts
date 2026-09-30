import type { ModeratorEventDetail } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { severityFromEvidence } from "../src/modules/event/index.js";
import type { NormalizedItem } from "../src/modules/ingestion/index.js";
import { createTestContext, createUser, LIMA, offset, type TestContext, type TestUser } from "./helpers.js";

let t: TestContext;
const now = new Date().toISOString();
const quake = (over: Partial<NormalizedItem>): NormalizedItem => ({
  externalId: "us-sev-1", categoryCode: "natural.earthquake", point: offset(LIMA, -60_000), uncertaintyM: 5000,
  occurredAt: now, publishedAt: now, title: { es: "Sismo" }, severity: 4, assertion: "OCCURRING", raw: {}, ...over,
});
const severityOf = async (id: string) => (await t.c.db.query<{ severity: number }>(`SELECT severity FROM event.events WHERE id = $1`, [id])).rows[0]!.severity;

async function asModerator(handle: string): Promise<TestUser> {
  const u = await createUser(t, handle);
  await t.c.identity.grantRole(u.userId, "moderator");
  const token = (await t.app.inject({ method: "POST", url: "/v1/auth/dev", payload: { handle, platform: "ANDROID", deviceId: u.deviceId } })).json().token as string;
  return { ...u, token };
}

beforeAll(async () => {
  t = await createTestContext();
  await t.c.ingestion.setSourceStatus("usgs-earthquakes", "ACTIVE");
});
afterAll(() => t.close());

describe("regla de gravedad (ADR 0160)", () => {
  it("corrección > oficial más reciente > mayor de las fuentes > por defecto", () => {
    const ev = [
      { trust_tier: "EXTERNAL" as const, severity: 2 },
      { trust_tier: "OFFICIAL" as const, severity: 3 },
      { trust_tier: "EXTERNAL" as const, severity: 5 },
      { trust_tier: "OFFICIAL" as const, severity: 4 },
    ];
    expect(severityFromEvidence(1, ev, 3)).toBe(1);
    expect(severityFromEvidence(null, ev, 1)).toBe(3);
    expect(severityFromEvidence(null, ev.filter((e) => e.trust_tier === "EXTERNAL"), 1)).toBe(5);
    expect(severityFromEvidence(null, [], 2)).toBe(2);
  });
});

describe("gravedad desde la evidencia (ADR 0160)", () => {
  it("una fuente que revisa su dato la sube o la baja, y moderación puede corregirla", async () => {
    const r = await t.c.ingestion.ingest("usgs-earthquakes", quake({}), "URGENT");
    const eventId = r.resolution && "eventId" in r.resolution ? r.resolution.eventId : "";
    await t.c.dispatcher.drain();
    expect(await severityOf(eventId)).toBe(4);

    // USGS rebaja la magnitud: el mismo ítem, con otro contenido, baja la gravedad (antes solo podía subir).
    await t.c.ingestion.ingest("usgs-earthquakes", quake({ severity: 2, title: { es: "Sismo revisado" } }), "URGENT");
    await t.c.dispatcher.drain();
    expect(await severityOf(eventId)).toBe(2);
    const tl = await t.c.db.query<{ payload: { from: number; to: number; cause: string } }>(
      `SELECT payload FROM event.timeline WHERE event_id = $1 AND type = 'SEVERITY_CHANGED' ORDER BY at`, [eventId],
    );
    expect(tl.rows.at(-1)!.payload).toEqual({ from: 4, to: 2, cause: "EVIDENCE" });

    // Corrección de moderación: manda sobre la evidencia, queda auditada y se puede quitar.
    const mod = await asModerator("mod_gravedad");
    const auth = { authorization: `Bearer ${mod.token}` };
    const set = await t.app.inject({ method: "POST", url: `/v1/moderation/events/${eventId}/severity`, headers: auth, payload: { severity: 5, reason: "Daños graves confirmados" } });
    expect(set.statusCode, set.body).toBe(200);
    const d = set.json() as ModeratorEventDetail;
    expect(d).toMatchObject({ severity: 5, severityOverride: 5 });
    expect(d.severityChanges[0]).toMatchObject({ from: 2, to: 5, override: 5, reason: "Daños graves confirmados" });
    await t.c.dispatcher.drain();

    // Con la corrección puesta, una revisión de la fuente no la mueve.
    await t.c.ingestion.ingest("usgs-earthquakes", quake({ severity: 3, title: { es: "Sismo revisado otra vez" } }), "URGENT");
    await t.c.dispatcher.drain();
    expect(await severityOf(eventId)).toBe(5);

    const again = await t.app.inject({ method: "POST", url: `/v1/moderation/events/${eventId}/severity`, headers: auth, payload: { severity: 5, reason: "otra vez" } });
    expect(again.statusCode).toBe(409);
    const clear = await t.app.inject({ method: "POST", url: `/v1/moderation/events/${eventId}/severity`, headers: auth, payload: { severity: null, reason: "Vuelve a mandar la fuente" } });
    expect(clear.statusCode, clear.body).toBe(200);
    expect(clear.json()).toMatchObject({ severity: 3, severityOverride: null });

    // Un ciudadano no puede corregir la gravedad.
    const u = await createUser(t, "vecino_gravedad");
    const denied = await t.app.inject({ method: "POST", url: `/v1/moderation/events/${eventId}/severity`, headers: { authorization: `Bearer ${u.token}` }, payload: { severity: 1, reason: "no me parece" } });
    expect(denied.statusCode).toBe(403);
  });
});
