import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";
import { Directory, File, Paths } from "expo-file-system";
import { discardLocal } from "../media/capture";
import { draftIsFresh, orphanMedia, referencedUris, type ReportDraft } from "./draft";
import { reportQueue } from "./outbox";

let db: Promise<SQLiteDatabase> | null = null;
const open = () => {
  db ??= openDatabaseAsync("dizaster.db").then(async (d) => {
    await d.execAsync(`CREATE TABLE IF NOT EXISTS report_draft (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL)`);
    return d;
  });
  return db;
};

/** Borrador vigente o null. Uno caducado se borra con sus fotos. */
export async function loadDraft(now = Date.now()): Promise<ReportDraft | null> {
  const row = await (await open()).getFirstAsync<{ value: string }>(`SELECT value FROM report_draft WHERE id = 1`);
  if (!row) return null;
  let d: ReportDraft | null;
  try { d = JSON.parse(row.value) as ReportDraft; } catch { d = null; }
  if (draftIsFresh(d, now)) return d;
  await clearDraft({ discardMedia: true, draft: d });
  return null;
}

export async function saveDraft(d: ReportDraft): Promise<void> {
  await (await open()).runAsync(`INSERT OR REPLACE INTO report_draft (id, value) VALUES (1, ?)`, JSON.stringify(d));
}

/** Al enviar, las fotos pasan a la cola (no se borran); al descartar, sí. */
export async function clearDraft(opts: { discardMedia: boolean; draft?: ReportDraft | null }): Promise<void> {
  if (opts.discardMedia) for (const m of opts.draft?.media ?? []) discardLocal(m);
  await (await open()).runAsync(`DELETE FROM report_draft WHERE id = 1`);
}

/**
 * Limpieza al arrancar (ADR 0191): fotos y videos de `pending-media` que no están ni en la cola ni en el borrador
 * (p. ej. de un reporte abandonado antes de esta versión) y con más de una hora.
 */
export async function cleanOrphanMedia(now = Date.now()): Promise<number> {
  const dir = new Directory(Paths.document, "pending-media");
  if (!dir.exists) return 0;
  const draft = await loadDraft(now).catch(() => null);
  const queued = await reportQueue.pending();
  const referenced = new Set([...referencedUris(draft?.media ?? []), ...queued.flatMap((q) => referencedUris(q.media ?? []))]);
  const files = dir.list().flatMap((e) => (e instanceof File ? [{ uri: e.uri, modifiedAt: e.lastModified }] : []));
  const doomed = orphanMedia(files, referenced, now);
  for (const uri of doomed) discardLocal({ localUri: uri });
  return doomed.length;
}
