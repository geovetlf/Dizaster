/**
 * Comprobación de SLO de una revisión (Blueprint §5.22 y §20.14, ADR 0277). Determinística: recibe lo observado
 * (resumen de k6, muestras de `dzd verify` o una exportación de Cloud Monitoring) y lo compara con los objetivos de la
 * política. Los objetivos son los del tablero de calidad (ADR 0026/0130): API p95 < 300 ms. Una tasa de errores máxima
 * no está decidida: mientras sea null se informa y no bloquea; un 5xx en una prueba de humo sí bloquea siempre.
 */
export interface SloTargets {
  apiP95Ms: number;
  maxErrorRate: number | null;
  /** Por debajo de esta cantidad de muestras no se juzga la latencia (un p95 de 3 peticiones no dice nada). */
  minSamples: number;
}

export interface Observation {
  samples: number;
  p95Ms: number | null;
  /** Fracción 0–1 de peticiones fallidas (5xx o red). */
  errorRate: number | null;
  serverErrors: number;
}

export interface SloResult { ok: boolean; findings: { check: string; ok: boolean; detail: string; enforced: boolean }[] }

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[idx]!;
}

export function fromSamples(samples: { ms: number; status: number }[]): Observation {
  const errors = samples.filter((s) => s.status === 0 || s.status >= 500).length;
  return {
    samples: samples.length,
    p95Ms: percentile(samples.map((s) => s.ms), 95),
    errorRate: samples.length ? errors / samples.length : null,
    serverErrors: errors,
  };
}

/** Resumen de `k6 run --summary-export`. */
export function fromK6Summary(raw: unknown): Observation {
  const m = (raw as { metrics?: Record<string, Record<string, number>> }).metrics ?? {};
  const reqs = m["http_reqs"]?.["count"] ?? 0;
  const failedRate = m["http_req_failed"]?.["value"] ?? m["http_req_failed"]?.["rate"] ?? null;
  return {
    samples: reqs,
    p95Ms: m["http_req_duration"]?.["p(95)"] ?? null,
    errorRate: failedRate,
    serverErrors: failedRate === null ? 0 : Math.round(failedRate * reqs),
  };
}

export function evaluateSlo(o: Observation, t: SloTargets, opts: { smoke?: boolean } = {}): SloResult {
  const findings: SloResult["findings"] = [];
  if (o.samples < t.minSamples || o.p95Ms === null) {
    findings.push({ check: "latencia p95", ok: true, enforced: false, detail: `sin muestras suficientes (${o.samples} < ${t.minSamples}): no se juzga` });
  } else {
    const ok = o.p95Ms < t.apiP95Ms;
    findings.push({ check: "latencia p95", ok, enforced: true, detail: `${Math.round(o.p95Ms)} ms ${ok ? "<" : "≥"} ${t.apiP95Ms} ms` });
  }
  if (opts.smoke) {
    findings.push({ check: "errores de servidor", ok: o.serverErrors === 0, enforced: true, detail: `${o.serverErrors} respuestas 5xx o sin respuesta` });
  }
  if (o.errorRate !== null) {
    const pct = `${(o.errorRate * 100).toFixed(2)} %`;
    if (t.maxErrorRate === null) findings.push({ check: "tasa de errores", ok: true, enforced: false, detail: `${pct} (sin objetivo decidido: solo se informa)` });
    else findings.push({ check: "tasa de errores", ok: o.errorRate <= t.maxErrorRate, enforced: true, detail: `${pct} (máx. ${(t.maxErrorRate * 100).toFixed(2)} %)` });
  }
  return { ok: findings.every((f) => f.ok || !f.enforced), findings };
}

export function validateSloTargets(raw: unknown): string[] {
  const s = raw as Partial<SloTargets> | undefined;
  if (!s || typeof s !== "object") return ["slo falta"];
  const errors: string[] = [];
  if (typeof s.apiP95Ms !== "number" || s.apiP95Ms <= 0) errors.push("slo.apiP95Ms debe ser > 0");
  if (s.maxErrorRate !== null && (typeof s.maxErrorRate !== "number" || s.maxErrorRate < 0 || s.maxErrorRate > 1)) errors.push("slo.maxErrorRate es null o 0–1");
  if (!Number.isInteger(s.minSamples) || s.minSamples! < 1) errors.push("slo.minSamples debe ser entero ≥ 1");
  return errors;
}
