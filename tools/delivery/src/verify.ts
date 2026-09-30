/** Una comprobación posterior al despliegue (Verification Engine, Blueprint §20.14). */
export interface Check { name: string; path: string; status?: number; maxMs?: number; bodyIncludes?: string }
export interface CheckResult { name: string; ok: boolean; ms: number; detail: string }

/**
 * Comprobaciones por defecto: solo lectura, sin datos de personas y sin efectos. `/health/ready` ya cubre el latido
 * del worker y la cola (ADR 0187); el contrato OpenAPI confirma que responde la versión esperada.
 */
export const DEFAULT_CHECKS: Check[] = [
  { name: "vivo", path: "/health", status: 200, maxMs: 2000 },
  { name: "listo (worker y cola)", path: "/health/ready", status: 200, maxMs: 3000 },
  { name: "contrato OpenAPI", path: "/v1/openapi.json", status: 200, maxMs: 3000, bodyIncludes: "\"openapi\"" },
  // Lecturas públicas del camino crítico (§20.14): configuración de la app, catálogo, mapa (PostGIS) y feed.
  { name: "configuración de la app", path: "/v1/config", status: 200, maxMs: 2000, bodyIncludes: "\"apiVersion\":\"v1\"" },
  { name: "catálogo de categorías", path: "/v1/reference/categories", status: 200, maxMs: 2000 },
  { name: "mapa (consulta geográfica)", path: "/v1/events?bbox=-77.2,-12.2,-76.9,-11.9&zoom=10", status: 200, maxMs: 3000 },
  { name: "feed público", path: "/v1/feed", status: 200, maxMs: 3000 },
];

export type Fetcher = (url: string, init: { signal: AbortSignal }) => Promise<{ status: number; text(): Promise<string> }>;

export async function runChecks(baseUrl: string, checks: Check[] = DEFAULT_CHECKS, fetcher: Fetcher = fetch as unknown as Fetcher): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  for (const c of checks) {
    const started = performance.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), (c.maxMs ?? 5000) * 2);
    try {
      const res = await fetcher(new URL(c.path, baseUrl).toString(), { signal: ctrl.signal });
      const body = c.bodyIncludes ? await res.text() : "";
      const ms = Math.round(performance.now() - started);
      const problems = [
        res.status !== (c.status ?? 200) ? `estado ${res.status}` : "",
        c.maxMs !== undefined && ms > c.maxMs ? `${ms} ms > ${c.maxMs} ms` : "",
        c.bodyIncludes && !body.includes(c.bodyIncludes) ? "respuesta inesperada" : "",
      ].filter(Boolean);
      out.push({ name: c.name, ok: problems.length === 0, ms, detail: problems.join("; ") || "ok" });
    } catch (e) {
      out.push({ name: c.name, ok: false, ms: Math.round(performance.now() - started), detail: e instanceof Error ? e.message : String(e) });
    } finally {
      clearTimeout(timer);
    }
  }
  return out;
}

export const allOk = (r: CheckResult[]): boolean => r.every((c) => c.ok);
