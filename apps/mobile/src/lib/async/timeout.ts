/** Resultado o `null` si no llega a tiempo (el trabajo sigue, pero ya no se espera). NO AI REQUIRED. */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(null), ms);
    p.then((v) => { clearTimeout(timer); resolve(v); }, (e: unknown) => { clearTimeout(timer); reject(e); });
  });
}

/** Tiempo máximo para el primer fix del GPS al reportar (ADR 0183). Bajo techo puede no llegar nunca. */
export const FIX_TIMEOUT_MS = 20_000;

/** Tiempo máximo de una petición a la API (ADR 0190): con red mala, un reporte no se queda colgado para siempre. */
export const REQUEST_TIMEOUT_MS = 30_000;

/**
 * `fetch` con tiempo límite. Al vencer se aborta y falla como un error de red (sin `status`), así la cola lo trata
 * como "sin conexión" y reintenta. Respeta la señal de quien llama, si la hay.
 */
export async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = REQUEST_TIMEOUT_MS, doFetch: typeof fetch = fetch): Promise<Response> {
  const ctrl = new AbortController();
  const outer = init.signal;
  if (outer?.aborted) ctrl.abort();
  const onAbort = () => ctrl.abort();
  outer?.addEventListener("abort", onAbort);
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await doFetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if (ctrl.signal.aborted && !outer?.aborted) throw new Error(`Sin respuesta en ${Math.round(ms / 1000)} s`, { cause: e });
    throw e;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", onAbort);
  }
}
