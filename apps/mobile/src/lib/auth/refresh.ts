/**
 * Lógica pura de la sesión (sin Expo, para poder probarla): el token de acceso dura 15 minutos y el refresh
 * rota en cada uso. Si varias peticiones reciben 401 a la vez, se renueva una sola vez y todas reintentan:
 * dos renovaciones en paralelo con el mismo refresh harían que el servidor detectara un reuso y cerrara la sesión.
 */
export function singleFlight<T>(fn: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | null = null;
  return () => {
    inFlight ??= fn().finally(() => { inFlight = null; });
    return inFlight;
  };
}

/** Solo se reintenta una vez, nunca en las rutas de autenticación y solo si hay con qué renovar. */
export function canRetryWithRefresh(path: string, status: number, alreadyRetried: boolean, hasRefreshToken: boolean): boolean {
  return status === 401 && !alreadyRetried && hasRefreshToken && !path.startsWith("/v1/auth/");
}

/**
 * Borrar la cuenta es irreversible: se pide escribir una palabra (traducida) antes de habilitar el botón.
 * Se ignoran mayúsculas, tildes y espacios alrededor para no frustrar a quien lo escribe bien.
 */
export function deleteConfirmed(input: string, word: string): boolean {
  const norm = (s: string) => s.trim().normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase();
  return word.length > 0 && norm(input) === norm(word);
}
