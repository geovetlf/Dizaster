import type { Fetcher } from "./verify.js";

/**
 * Carga mínima sin dependencias (ADR 0282): `requests` peticiones GET de solo lectura repartidas en `paths`, con
 * `concurrency` en paralelo. Devuelve muestras para `evaluateSlo`. Para cargas más grandes está `infra/load/smoke.js`
 * (k6), cuyo resumen lee `dzd slo --k6`. Solo lecturas públicas: nunca crea datos ni usa sesiones.
 */
export const DEFAULT_LOAD_PATHS = ["/health", "/v1/config", "/v1/reference/categories", "/v1/events?bbox=-77.2,-12.2,-76.9,-11.9&zoom=10", "/v1/feed"];

export interface LoadOptions { url: string; requests: number; concurrency: number; paths?: string[]; timeoutMs?: number; fetcher?: Fetcher }
export interface Sample { path: string; ms: number; status: number }

export async function runLoad(o: LoadOptions): Promise<Sample[]> {
  if (!Number.isInteger(o.requests) || o.requests < 1 || o.requests > 10_000) throw new Error("requests: entero entre 1 y 10000");
  if (!Number.isInteger(o.concurrency) || o.concurrency < 1 || o.concurrency > 100) throw new Error("concurrency: entero entre 1 y 100");
  const paths = o.paths?.length ? o.paths : DEFAULT_LOAD_PATHS;
  const fetcher = o.fetcher ?? (fetch as unknown as Fetcher);
  const samples: Sample[] = new Array(o.requests);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < o.requests; i = next++) {
      const path = paths[i % paths.length]!;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), o.timeoutMs ?? 10_000);
      const started = performance.now();
      let status: number;
      try {
        const r = await fetcher(new URL(path, o.url).toString(), { signal: ctrl.signal });
        await r.text();
        status = r.status;
      } catch { status = 0; } finally { clearTimeout(timer); }
      samples[i] = { path, ms: Math.round(performance.now() - started), status };
    }
  };
  await Promise.all(Array.from({ length: Math.min(o.concurrency, o.requests) }, worker));
  return samples;
}
