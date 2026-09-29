import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Db } from "./db.js";
import { withTransaction } from "./db.js";

/** Migrador mínimo y sin dependencias: aplica en orden los .sql no aplicados, cada uno en su transacción. */
export async function migrate(db: Db, dir: string): Promise<string[]> {
  await db.query(`CREATE SCHEMA IF NOT EXISTS platform`);
  await db.query(
    `CREATE TABLE IF NOT EXISTS platform.schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
  );
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const applied = new Set((await db.query<{ name: string }>(`SELECT name FROM platform.schema_migrations`)).rows.map((r) => r.name));
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(join(dir, file), "utf8");
    await withTransaction(db, async (tx) => {
      await tx.query(sql);
      await tx.query(`INSERT INTO platform.schema_migrations (name) VALUES ($1)`, [file]);
    });
    ran.push(file);
  }
  return ran;
}
