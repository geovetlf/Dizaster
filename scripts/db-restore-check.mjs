#!/usr/bin/env node
// Prueba de restauración (ADR 0070): un respaldo solo vale si se puede restaurar.
// 1. pg_dump de DATABASE_URL  2. restaura en una base temporal nueva  3. compara filas por tabla y la última migración
// 4. borra SOLO la base temporal que creó. Nunca escribe en la base de origen.
// Respaldo cifrado (ADR 0189): `respaldo.dump.age` + AGE_IDENTITY_FILE (clave privada de quien restaura). Si hay
// `.sha256` al lado, se comprueba antes de nada.
// Uso: DATABASE_URL=postgres://… [AGE_IDENTITY_FILE=clave.txt] node scripts/db-restore-check.mjs [respaldo.dump[.age]]
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const source = process.env.DATABASE_URL;
if (!source) { console.error("Falta DATABASE_URL"); process.exit(2); }
const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
const psql = (url, sql) => run("psql", ["-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", url, "-c", sql]).trim();

const tempName = `dizaster_restore_check_${Date.now()}`;
const adminUrl = new URL(source); adminUrl.pathname = "/postgres";
const tempUrl = new URL(source); tempUrl.pathname = `/${tempName}`;
const work = mkdtempSync(join(tmpdir(), "dz-restore-"));
const given = process.argv[2];
let dump = given ?? join(work, "check.dump");

const COUNTS = `SELECT string_agg(format('%s.%s=%s', schemaname, relname, n), ',' ORDER BY schemaname, relname) FROM (
  SELECT table_schema AS schemaname, table_name AS relname,
         (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint AS n
    FROM information_schema.tables
   WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog', 'information_schema', 'tiger', 'tiger_data', 'topology')
) t`;

let created = false;
try {
  if (!given) run("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", `--file=${dump}`, source]);
  if (given && existsSync(`${given}.sha256`)) {
    const expected = readFileSync(`${given}.sha256`, "utf8").trim().split(/\s+/)[0];
    const actual = run("sha256sum", [given]).split(/\s+/)[0];
    if (expected !== actual) throw new Error(`sha256 no coincide para ${basename(given)}`);
    console.log("sha256 verificado.");
  }
  if (given?.endsWith(".age")) {
    const identity = process.env.AGE_IDENTITY_FILE;
    if (!identity) throw new Error("Respaldo cifrado: falta AGE_IDENTITY_FILE (clave privada age de quien restaura)");
    dump = join(work, "decrypted.dump");
    run("age", ["-d", "-i", identity, "-o", dump, given]);
  }
  psql(adminUrl.href, `CREATE DATABASE ${tempName}`);
  created = true;
  run("pg_restore", ["--no-owner", "--no-privileges", "--exit-on-error", `--dbname=${tempUrl.href}`, dump]);
  const before = psql(source, COUNTS);
  const after = psql(tempUrl.href, COUNTS);
  const tables = before.split(",").length;
  if (before !== after) {
    const a = new Set(after.split(","));
    console.error("La restauración no coincide:", before.split(",").filter((x) => !a.has(x)).slice(0, 20));
    process.exitCode = 1;
  } else {
    console.log(`Restauración verificada: ${tables} tablas con el mismo número de filas.`);
  }
} catch (e) {
  console.error("Falló la prueba de restauración:", (e.stderr || e.message || String(e)).toString().slice(0, 2000));
  process.exitCode = 1;
} finally {
  if (created) {
    try { psql(adminUrl.href, `DROP DATABASE ${tempName}`); } catch { console.error(`No se pudo borrar la base temporal ${tempName}`); }
  }
  rmSync(work, { recursive: true, force: true });
}
