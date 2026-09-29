import type { EventMapResponse } from "@dizaster/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, createUser, LIMA, offset, reportBody, submit, type TestContext } from "./helpers.js";

let t: TestContext;
let id: string;
const pin = offset(LIMA, 12_000);
const onMap = async () => ((await t.app.inject({ url: "/v1/events?bbox=-78,-13,-76,-11&zoom=15" })).json() as EventMapResponse).events.some((e) => e.id === id);
const row = async () => (await t.c.db.query<{ status: string; resolved_at: Date | null }>(`SELECT status, resolved_at FROM event.events WHERE id = $1`, [id])).rows[0]!;

beforeAll(async () => {
  t = await createTestContext();
  const u = await createUser(t, "vecina_archivo");
  id = (await submit(t, u, reportBody(u, { category: "fire.structure", pin }))).body.eventId!;
  await t.c.dispatcher.drain();
});
afterAll(() => t.close());

describe("archivado de eventos (D-ARCHIVE, ADR 0061)", () => {
  it("RESOLVED sigue en el mapa y guarda cuándo se resolvió", async () => {
    await t.c.db.query(`UPDATE event.events SET status = 'RESOLVED' WHERE id = $1`, [id]);
    expect((await row()).resolved_at).not.toBeNull();
    expect(await onMap()).toBe(true);
    expect(await t.c.events.archiveResolved(t.c.db, new Date())).toBe(0);
  });

  it("a los 7 días pasa a ARCHIVED: fuera del mapa, pero accesible por enlace y con historial", async () => {
    await t.c.db.query(`UPDATE event.events SET resolved_at = now() - interval '8 days' WHERE id = $1`, [id]);
    expect(await t.c.events.archiveResolved(t.c.db, new Date())).toBe(1);
    expect((await row()).status).toBe("ARCHIVED");
    expect(await onMap()).toBe(false);
    const ev = await t.app.inject({ url: `/v1/events/${id}` });
    expect(ev.statusCode).toBe(200);
    expect(ev.json().status).toBe("ARCHIVED");
    const tl = (await t.app.inject({ url: `/v1/events/${id}/timeline` })).json().entries as { type: string; payload: { cause?: string } }[];
    expect(tl.some((e) => e.payload.cause === "ARCHIVE_AFTER_RESOLVED")).toBe(true);
    expect((await t.c.db.query(`SELECT 1 FROM event.evidence WHERE event_id = $1`, [id])).rowCount).toBeGreaterThan(0);
  });

  it("reactivar limpia resolved_at", async () => {
    await t.c.db.query(`UPDATE event.events SET status = 'ACTIVE' WHERE id = $1`, [id]);
    expect((await row()).resolved_at).toBeNull();
  });
});
