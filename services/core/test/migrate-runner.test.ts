import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, type Db } from "../src/platform/db.js";
import { migrate } from "../src/platform/migrate.js";
import { TEST_DB_URL } from "./helpers.js";

// Migrador (ADR 0273): candado contra migradores simultáneos y checksum de lo ya aplicado. Base propia y temporal.
const name = `dz_migrate_${process.pid}_${Date.now()}`;
const admin = new pg.Client({ connectionString: TEST_DB_URL });
let db: Db;
beforeAll(async () => {
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  const url = new URL(TEST_DB_URL);
  url.pathname = `/${name}`;
  db = createPool(url.toString());
});
afterAll(async () => {
  await db.end();
  await admin.query(`DROP DATABASE IF EXISTS ${name}`);
  await admin.end();
});

describe("migrador", () => {
  it("dos migradores a la vez aplican cada archivo una sola vez", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mig-"));
    writeFileSync(join(dir, "0001_a.sql"), "CREATE TABLE a (id int); SELECT pg_sleep(0.2);");
    writeFileSync(join(dir, "0002_b.sql"), "CREATE TABLE b (id int);");
    const [x, y] = await Promise.all([migrate(db, dir), migrate(db, dir)]);
    expect([...x, ...y].sort()).toEqual(["0001_a.sql", "0002_b.sql"]);
    const rows = (await db.query<{ name: string; checksum: string }>(`SELECT name, checksum FROM platform.schema_migrations ORDER BY name`)).rows;
    expect(rows.map((r) => r.name)).toEqual(["0001_a.sql", "0002_b.sql"]);
    expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.checksum))).toBe(true);

    // Editar una migración aplicada se detecta antes de aplicar nada más.
    writeFileSync(join(dir, "0002_b.sql"), "CREATE TABLE b (id bigint);");
    writeFileSync(join(dir, "0003_c.sql"), "CREATE TABLE c (id int);");
    await expect(migrate(db, dir)).rejects.toThrow(/0002_b\.sql/);
    expect((await db.query(`SELECT to_regclass('public.c') AS t`)).rows[0].t).toBeNull();
  });

  it("una migración que falla no deja nada a medias y libera el candado", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mig-"));
    writeFileSync(join(dir, "0001_a.sql"), "CREATE TABLE a (id int); SELECT pg_sleep(0.2);");
    writeFileSync(join(dir, "0002_b.sql"), "CREATE TABLE b (id int);");
    writeFileSync(join(dir, "0004_bad.sql"), "CREATE TABLE d (id int); SELECT 1/0;");
    await expect(migrate(db, dir)).rejects.toThrow();
    expect((await db.query(`SELECT to_regclass('public.d') AS t`)).rows[0].t).toBeNull();
    writeFileSync(join(dir, "0004_bad.sql"), "CREATE TABLE d (id int);");
    expect(await migrate(db, dir)).toEqual(["0004_bad.sql"]);
  });
});
