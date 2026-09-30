import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Db } from "./db.js";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * Migrador mínimo y sin dependencias: aplica en orden los .sql no aplicados, cada uno en su transacción.
 * - Un candado de sesión serializa migradores simultáneos (dos jobs a la vez no aplican lo mismo dos veces, ADR 0273).
 * - Guarda el sha256 de cada archivo: si una migración ya aplicada cambió, se detiene antes de tocar nada. Las filas
 *   anteriores al checksum lo reciben la primera vez.
 */
export async function migrate(db: Db, dir: string): Promise<string[]> {
  const client = await db.connect();
  try {
    await client.query(`SELECT pg_advisory_lock(hashtextextended('platform.migrate', 0))`);
    await client.query(`CREATE SCHEMA IF NOT EXISTS platform`);
    await client.query(
      `CREATE TABLE IF NOT EXISTS platform.schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
    );
    await client.query(`ALTER TABLE platform.schema_migrations ADD COLUMN IF NOT EXISTS checksum text`);
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    const sources = new Map<string, string>();
    for (const f of files) sources.set(f, await readFile(join(dir, f), "utf8"));
    const applied = new Map((await client.query<{ name: string; checksum: string | null }>(`SELECT name, checksum FROM platform.schema_migrations`)).rows.map((r) => [r.name, r.checksum]));
    const changed = files.filter((f) => applied.has(f) && applied.get(f) !== null && applied.get(f) !== sha256(sources.get(f)!));
    if (changed.length) throw new Error(`Migraciones ya aplicadas fueron modificadas: ${changed.join(", ")}. Se corrige con una migración nueva.`);
    for (const f of files) {
      if (applied.has(f) && applied.get(f) === null) await client.query(`UPDATE platform.schema_migrations SET checksum = $2 WHERE name = $1`, [f, sha256(sources.get(f)!)]);
    }
    const ran: string[] = [];
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = sources.get(file)!;
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(`INSERT INTO platform.schema_migrations (name, checksum) VALUES ($1, $2)`, [file, sha256(sql)]);
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
      ran.push(file);
    }
    return ran;
  } finally {
    await client.query(`SELECT pg_advisory_unlock(hashtextextended('platform.migrate', 0))`).catch(() => undefined);
    client.release();
  }
}
