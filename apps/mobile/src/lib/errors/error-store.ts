import { File, Paths } from "expo-file-system";
import { appendEntry, markSent, parseLog, toEntry, unsentEntries, type ErrorEntry } from "./error-log";

const file = () => new File(Paths.document, "errors.json");

export function readErrorLog(): ErrorEntry[] {
  try {
    const f = file();
    return f.exists ? parseLog(JSON.parse(f.textSync())) : [];
  } catch {
    return [];
  }
}

function writeLog(log: readonly ErrorEntry[]): void {
  const f = file();
  if (f.exists) f.delete();
  f.create();
  f.write(JSON.stringify(log));
}

/** Guarda el error en el registro local e intenta enviarlo. Nunca lanza: registrar un fallo no puede provocar otro. */
export function recordError(error: unknown, where: string | null = null): void {
  try {
    writeLog(appendEntry(readErrorLog(), toEntry(error, where, new Date())));
  } catch {
    // Sin espacio o sin permiso: se pierde el registro, nunca la app.
  }
  void sendPendingErrors();
}

type CrashSender = (entries: ReturnType<typeof unsentEntries>) => Promise<unknown>;
let sender: CrashSender | null = null;
let sending = false;

/**
 * Envío al servidor propio (ADR 0173), anónimo y ya redactado. Lo conecta el arranque de la app para no importar
 * aquí el cliente de la API. Sin red queda pendiente para el próximo arranque o el próximo fallo.
 */
export function setCrashSender(s: CrashSender): void {
  sender = s;
}

export async function sendPendingErrors(): Promise<void> {
  if (!sender || sending) return;
  sending = true;
  try {
    const pending = unsentEntries(readErrorLog());
    if (pending.length === 0) return;
    await sender(pending);
    writeLog(markSent(readErrorLog(), pending.map((e) => e.at)));
  } catch {
    // Sin red o servidor caído: se reintenta más tarde.
  } finally {
    sending = false;
  }
}

export function clearErrorLog(): void {
  try {
    const f = file();
    if (f.exists) f.delete();
  } catch {
    // nada
  }
}
