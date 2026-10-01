import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RUNS_RETENTION_DAYS } from "../src/modules/ingestion/scheduler.js";
import { newId } from "../src/platform/ids.js";
import { createTestContext, type TestContext } from "./helpers.js";

// Ítems de fuentes que no llegaron a ningún evento se borran tras la retención (ADR 0293). NO AI REQUIRED.
let t: TestContext;
beforeAll(async () => { t = await createTestContext(); });
afterAll(async () => { await t.close(); });

describe("retención de ítems de fuentes sin evento", () => {
  it("borra IGNORED y ERROR viejos sin evento; conserva los recientes y los ligados a un evento", async () => {
    const now = new Date("2027-03-01T00:00:00Z");
    const old = new Date(now.getTime() - (RUNS_RETENTION_DAYS + 1) * 86_400_000);
    const recent = new Date(now.getTime() - (RUNS_RETENTION_DAYS - 1) * 86_400_000);
    const source = (await t.c.db.query<{ id: string }>(`SELECT id FROM ingestion.sources ORDER BY key LIMIT 1`)).rows[0]!.id;
    const item = async (status: string, fetchedAt: Date, eventId: string | null = null) => {
      const id = newId();
      await t.c.db.query(
        `INSERT INTO ingestion.external_items (id, source_id, external_id, content_hash, lane, normalized, status, event_id, fetched_at)
         VALUES ($1, $2, $3, 'h', 'NORMAL', '{}', $4, $5, $6)`,
        [id, source, `ret-${id}`, status, eventId, fetchedAt],
      );
      return id;
    };
    const gone = [await item("IGNORED", old), await item("ERROR", old)];
    const kept = [await item("IGNORED", recent), await item("MAPPED", old, newId()), await item("NEW", old)];

    expect(await t.c.ingestionScheduler.purgeUnusedItems(now, 1)).toEqual({ deleted: 2 }); // varios lotes de 1
    const left = new Set((await t.c.db.query<{ id: string }>(`SELECT id FROM ingestion.external_items WHERE id = ANY($1)`, [[...gone, ...kept]])).rows.map((r) => r.id));
    expect(gone.some((id) => left.has(id))).toBe(false);
    expect(kept.every((id) => left.has(id))).toBe(true);
    expect(await t.c.ingestionScheduler.purgeUnusedItems(now)).toEqual({ deleted: 0 });
  });
});
