import { v7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { monthPartitionDdl, monthPartitions, uuidV7Floor } from "../src/platform/partitioning.js";
import { createTestContext, createUser, reportBody, submit, type TestContext } from "./helpers.js";

// Particionado mensual preparado (§7.4, ADR 0182): se prueba sobre copias, las tablas reales no se tocan.
let t: TestContext;
beforeAll(async () => { t = await createTestContext(); });
afterAll(async () => { await t.close(); });

describe("límites por mes con UUIDv7", () => {
  it("cualquier id creado en un mes cae entre sus límites", () => {
    const [sep, oct] = monthPartitions(new Date("2026-09-15T00:00:00Z"), 2);
    expect(sep!.suffix).toBe("y2026m09");
    expect(sep!.to).toBe(oct!.from);
    for (const at of ["2026-09-01T00:00:00.000Z", "2026-09-30T23:59:59.999Z"]) {
      const id = v7({ msecs: Date.parse(at) });
      expect(id >= sep!.from && id < sep!.to).toBe(true);
    }
    expect(v7({ msecs: Date.parse("2026-10-01T00:00:00Z") }) >= sep!.to).toBe(true);
    expect(uuidV7Floor(new Date(0))).toBe("00000000-0000-7000-8000-000000000000");
    expect(() => monthPartitionDdl("event.events; DROP", sep!)).toThrow();
  });

  it("una copia de event.events y report.reports particionada por id acepta los datos reales y los reparte por mes", async () => {
    const u = await createUser(t, "part");
    const r = await submit(t, u, reportBody(u));
    expect(r.status).toBe(200);
    const months = monthPartitions(new Date(Date.now() - 31 * 86_400_000), 3);
    await t.c.db.query(`CREATE SCHEMA IF NOT EXISTS part_check`);
    for (const [src, dst] of [["event.events", "part_check.events"], ["report.reports", "part_check.reports"]] as const) {
      // Mismas columnas (incluidas las generadas) y la misma PK; las únicas sin id no caben en una tabla partida.
      await t.c.db.query(`CREATE TABLE ${dst} (LIKE ${src} INCLUDING DEFAULTS INCLUDING GENERATED INCLUDING CONSTRAINTS) PARTITION BY RANGE (id)`);
      await t.c.db.query(`ALTER TABLE ${dst} ADD PRIMARY KEY (id)`);
      for (const m of months) await t.c.db.query(monthPartitionDdl(dst, m));
      const cols = (await t.c.db.query<{ c: string }>(
        `SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) AS c FROM pg_attribute
          WHERE attrelid = $1::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = ''`, [src])).rows[0]!.c;
      await t.c.db.query(`INSERT INTO ${dst} (${cols}) SELECT ${cols} FROM ${src}`);
      const n = (await t.c.db.query<{ a: number; b: number }>(`SELECT (SELECT count(*) FROM ${src})::int AS a, (SELECT count(*) FROM ${dst})::int AS b`)).rows[0]!;
      expect(n.b).toBe(n.a);
      const current = `${dst}_${months[1]!.suffix}`;
      expect((await t.c.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${current}`)).rows[0]!.n).toBe(n.a);
    }
    // El índice único de idempotencia no incluye id: al partir, pasa a una tabla aparte (ver ADR 0182).
    await expect(t.c.db.query(`CREATE UNIQUE INDEX ON part_check.reports (author_user_id, client_report_id)`)).rejects.toThrow(/partition/i);
    await t.c.db.query(`DROP SCHEMA part_check CASCADE`);
  });
});
