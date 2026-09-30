import { File, Paths } from "expo-file-system";
import { appendEntry, parseLog, toEntry, type ErrorEntry } from "./error-log";

const file = () => new File(Paths.document, "errors.json");

export function readErrorLog(): ErrorEntry[] {
  try {
    const f = file();
    return f.exists ? parseLog(JSON.parse(f.textSync())) : [];
  } catch {
    return [];
  }
}

/** Guarda el error en el registro local. Nunca lanza: registrar un fallo no puede provocar otro. */
export function recordError(error: unknown, where: string | null = null): void {
  try {
    const f = file();
    const next = appendEntry(readErrorLog(), toEntry(error, where, new Date()));
    if (f.exists) f.delete();
    f.create();
    f.write(JSON.stringify(next));
  } catch {
    // Sin espacio o sin permiso: se pierde el registro, nunca la app.
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
