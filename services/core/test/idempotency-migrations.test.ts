import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, type Db } from "../src/platform/db.js";
import { migrate } from "../src/platform/migrate.js";
import { MIGRATIONS_DIR } from "../src/platform/paths.js";
import { TEST_DB_URL } from "./helpers.js";

/**
 * Migraciones reales desde cero (ADR 0344): en una base vacía y propia se aplican todas, en orden y con checksum; volver
 * a ejecutar el migrador no cambia nada del catálogo; dos migradores a la vez sobre la base vacía no aplican nada dos
 * veces. Complementa `migrate-runner.test.ts`, que prueba el migrador con archivos sintéticos.
 */
const name = `dz_migrate_real_${process.pid}_${Date.now()}`;
const admin = new pg.Client({ connectionString: TEST_DB_URL });
const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
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

/** Huella del catálogo de los esquemas propios: tablas, columnas, índices, restricciones, funciones, disparadores y vistas. */
async function catalog(): Promise<string[]> {
  const own = `NOT IN ('pg_catalog', 'information_schema', 'pg_toast', 'tiger', 'tiger_data', 'topology')`;
  const parts = await Promise.all([
    db.query(`SELECT table_schema || '.' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '') AS x
                FROM information_schema.columns WHERE table_schema ${own}`),
    db.query(`SELECT schemaname || '.' || indexname || ':' || indexdef AS x FROM pg_indexes WHERE schemaname ${own}`),
    db.query(`SELECT n.nspname || '.' || c.conname || ':' || pg_get_constraintdef(c.oid) AS x
                FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname ${own}`),
    db.query(`SELECT n.nspname || '.' || p.proname || ':' || md5(p.prosrc) AS x
                FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname ${own} AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')`),
    db.query(`SELECT t.tgrelid::regclass::text || '.' || t.tgname || ':' || pg_get_triggerdef(t.oid) AS x FROM pg_trigger t WHERE NOT t.tgisinternal`),
    db.query(`SELECT schemaname || '.' || viewname || ':' || md5(definition) AS x FROM pg_views WHERE schemaname ${own}`),
    db.query(`SELECT extname || ':' || extversion AS x FROM pg_extension`),
  ]);
  return parts.flatMap((r) => r.rows.map((row: { x: string }) => row.x)).sort();
}

describe("migraciones reales desde cero", () => {
  it("dos migradores a la vez sobre la base vacía aplican cada archivo una sola vez y en orden", async () => {
    expect(files.length).toBeGreaterThan(100);
    // Numeración sin huecos ni repeticiones: el orden lexicográfico es el de aplicación.
    expect(files.map((f) => Number(f.slice(0, 4)))).toEqual(files.map((_, i) => i + 1));
    const [a, b] = await Promise.all([migrate(db, MIGRATIONS_DIR), migrate(db, MIGRATIONS_DIR)]);
    expect([...a, ...b].sort()).toEqual(files);
    const { rows } = await db.query<{ name: string; checksum: string; applied_at: Date }>(
      `SELECT name, checksum, applied_at FROM platform.schema_migrations ORDER BY applied_at, name`,
    );
    expect(rows.map((r) => r.name)).toEqual(files);
    for (const r of rows) expect(r.checksum, r.name).toBe(sha256(readFileSync(join(MIGRATIONS_DIR, r.name), "utf8")));
  });

  it("volver a migrar no aplica nada ni cambia el catálogo, y libera el candado", async () => {
    const before = await catalog();
    expect(before.length).toBeGreaterThan(500);
    const applied = (await db.query(`SELECT name, checksum, applied_at FROM platform.schema_migrations ORDER BY name`)).rows;
    expect(await migrate(db, MIGRATIONS_DIR)).toEqual([]);
    expect(await migrate(db, MIGRATIONS_DIR)).toEqual([]);
    expect(await catalog()).toEqual(before);
    expect((await db.query(`SELECT name, checksum, applied_at FROM platform.schema_migrations ORDER BY name`)).rows).toEqual(applied);
    const held = async () => (await db.query(
      `SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
          AND objid = (hashtextextended('platform.migrate', 0) & 4294967295)::oid`,
    )).rowCount;
    expect(await held()).toBe(0);
    // La consulta sí ve el candado cuando alguien lo tiene (la comprobación anterior no es trivial).
    const holder = await db.connect();
    try {
      await holder.query(`SELECT pg_advisory_lock(hashtextextended('platform.migrate', 0))`);
      expect(await held()).toBe(1);
    } finally {
      await holder.query(`SELECT pg_advisory_unlock(hashtextextended('platform.migrate', 0))`);
      holder.release();
    }
  });

  it("una fila antigua sin checksum lo recibe al migrar, sin reaplicar el archivo", async () => {
    const first = files[0]!;
    await db.query(`UPDATE platform.schema_migrations SET checksum = NULL WHERE name = $1`, [first]);
    expect(await migrate(db, MIGRATIONS_DIR)).toEqual([]);
    const { rows } = await db.query<{ checksum: string }>(`SELECT checksum FROM platform.schema_migrations WHERE name = $1`, [first]);
    expect(rows[0]!.checksum).toBe(sha256(readFileSync(join(MIGRATIONS_DIR, first), "utf8")));
  });
});
