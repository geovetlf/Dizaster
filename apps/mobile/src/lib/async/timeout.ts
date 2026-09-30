/** Resultado o `null` si no llega a tiempo (el trabajo sigue, pero ya no se espera). NO AI REQUIRED. */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(null), ms);
    p.then((v) => { clearTimeout(timer); resolve(v); }, (e: unknown) => { clearTimeout(timer); reject(e); });
  });
}

/** Tiempo máximo para el primer fix del GPS al reportar (ADR 0183). Bajo techo puede no llegar nunca. */
export const FIX_TIMEOUT_MS = 20_000;
