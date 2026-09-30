#!/usr/bin/env node
// Retención de respaldos (ADR 0189). NO AI REQUIRED.
// Conserva los últimos BACKUP_KEEP_LAST respaldos y, además, el más reciente de cada una de las últimas
// BACKUP_KEEP_WEEKS semanas. Solo toca archivos con el nombre exacto que crea db-backup.sh; nunca el más reciente.
// Uso: BACKUP_KEEP_LAST=14 BACKUP_KEEP_WEEKS=8 node scripts/backup-retention.mjs <directorio>
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const NAME = /^dizaster-(\d{8}T\d{6}Z)\.dump(\.age)?$/;

/** Lunes (UTC) de la semana del respaldo: clave de semana. */
function weekOf(stamp) {
  const d = new Date(`${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** Qué respaldos borrar, de una lista de nombres de archivo. Pura: la prueba la usa directamente. */
export function backupsToDelete(names, { keepLast, keepWeeks }) {
  const backups = names.map((n) => ({ n, m: NAME.exec(n) })).filter((x) => x.m).map((x) => ({ name: x.n, stamp: x.m[1] }));
  backups.sort((a, b) => (a.stamp < b.stamp ? 1 : a.stamp > b.stamp ? -1 : 0));
  const keep = new Set(backups.slice(0, Math.max(1, keepLast)).map((b) => b.name));
  const weeks = new Set();
  for (const b of backups) {
    const w = weekOf(b.stamp);
    if (weeks.has(w)) continue;
    if (weeks.size >= keepWeeks) break;
    weeks.add(w);
    keep.add(b.name);
  }
  return backups.filter((b) => !keep.has(b.name)).map((b) => b.name);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const dir = process.argv[2];
  if (!dir) { console.error("Uso: backup-retention.mjs <directorio>"); process.exit(2); }
  const keepLast = Number(process.env.BACKUP_KEEP_LAST ?? 14);
  const keepWeeks = Number(process.env.BACKUP_KEEP_WEEKS ?? 8);
  if (!Number.isInteger(keepLast) || keepLast < 1 || !Number.isInteger(keepWeeks) || keepWeeks < 0) {
    console.error("BACKUP_KEEP_LAST ≥ 1 y BACKUP_KEEP_WEEKS ≥ 0"); process.exit(2);
  }
  const doomed = backupsToDelete(readdirSync(dir), { keepLast, keepWeeks });
  for (const name of doomed) {
    rmSync(join(dir, name), { force: true });
    rmSync(join(dir, `${name}.sha256`), { force: true });
  }
  console.log(`Retención: ${doomed.length} respaldos borrados`);
}
