import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { dailyJobs, hourlyJobs, runJobs } from "../src/maintenance.js";
import { createTestContext, type TestContext } from "./helpers.js";

// ADR 0243: un fallo en una tarea de mantenimiento no salta las demás.
describe("tareas de mantenimiento aisladas", () => {
  let t: TestContext;
  beforeAll(async () => { t = await createTestContext(); });
  afterAll(async () => { await t.close(); });

  it("si falla la retención de media, las demás tareas diarias corren igual", async () => {
    const media = vi.spyOn(t.c.media, "applyRetention").mockRejectedValue(new Error("S3 caído"));
    const outbox = vi.spyOn(t.c.dispatcher, "purgeProcessed");
    const crashes = vi.spyOn(t.c.crashes, "applyRetention");
    const warned: string[] = [];
    const { failed } = await runJobs(dailyJobs(t.c), () => undefined, (m) => warned.push(m));
    expect(failed).toEqual(["retention.media"]);
    expect(warned).toEqual(["retention.media.failed"]);
    expect(outbox).toHaveBeenCalled();
    expect(crashes).toHaveBeenCalled();
    media.mockRestore();
  });

  it("la generalización de presencia es la primera tarea diaria", () => {
    expect(dailyJobs(t.c)[0]![0]).toBe("retention.presence.generalized");
  });

  it("si falla el ciclo de vida, el archivo y los duplicados siguen", async () => {
    const lifecycle = vi.spyOn(t.c.events, "applyLifecycle").mockRejectedValue(new Error("tiempo agotado"));
    const dup = vi.spyOn(t.c.events, "sweepDuplicates");
    const { failed } = await runJobs(hourlyJobs(t.c), () => undefined, () => undefined);
    expect(failed).toEqual(["events.lifecycle"]);
    expect(dup).toHaveBeenCalled();
    lifecycle.mockRestore();
  });
});

describe("ciclo de vida con aviso oficial vigente (ADR 0244)", () => {
  let t: TestContext;
  beforeAll(async () => { t = await createTestContext(); await t.c.ingestion.setSourceStatus("usgs-earthquakes", "ACTIVE"); });
  afterAll(async () => { await t.close(); });

  it("un evento inactivo con aviso vigente no se cierra; sin aviso, sí", async () => {
    const now = new Date().toISOString();
    const item = (id: string, lat: number, endsAt: string | null) => ({
      externalId: id, categoryCode: "natural.earthquake", point: { lat, lng: -77 }, uncertaintyM: 1000, occurredAt: now, publishedAt: now,
      title: { es: "Sismo" }, severity: 3, assertion: "OCCURRING" as const, endsAt, raw: {},
    });
    const vigente = await t.c.ingestion.ingest("usgs-earthquakes", item("vig-1", -10, new Date(Date.now() + 5 * 86_400_000).toISOString()), "NORMAL");
    const sinAviso = await t.c.ingestion.ingest("usgs-earthquakes", item("sin-1", -14, null), "NORMAL");
    const id = (r: typeof vigente) => (r.resolution as { eventId: string }).eventId;
    await t.c.db.query(`UPDATE event.events SET last_activity_at = now() - interval '30 days' WHERE id = ANY($1)`, [[id(vigente), id(sinAviso)]]);
    await runJobs(hourlyJobs(t.c).filter(([n]) => n === "events.lifecycle"), () => undefined, () => undefined);
    const status = async (e: string) => (await t.c.db.query<{ status: string }>(`SELECT status FROM event.events WHERE id = $1`, [e])).rows[0]!.status;
    expect(await status(id(vigente))).toBe("ACTIVE");
    expect(await status(id(sinAviso))).toBe("RESOLVED");
    // Su cambio de estado salió en el outbox dentro de la misma transacción.
    const { rowCount } = await t.c.db.query(`SELECT 1 FROM platform.outbox WHERE payload->>'eventId' = $1 AND type = 'EventLifecycleChanged'`, [id(sinAviso)]);
    expect(rowCount).toBe(1);
  });
});
