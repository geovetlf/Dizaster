/**
 * Medidor de uso por módulo (Blueprint §5.18 CostMeter). Acumula en memoria y se vuelca en lote a una fila por
 * (día, módulo, métrica, proveedor): medir no cuesta una escritura por petición.
 */
export interface UsageEntry {
  day: string;
  module: string;
  metric: string;
  provider: string;
  units: number;
}

export interface UsageSink {
  persistUsage(entries: UsageEntry[]): Promise<void>;
}

export class Meter {
  private pending = new Map<string, UsageEntry>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  add(module: string, metric: string, units = 1, provider = ""): void {
    if (!Number.isFinite(units) || units === 0) return;
    const day = this.now().toISOString().slice(0, 10);
    const key = `${day}|${module}|${metric}|${provider}`;
    const cur = this.pending.get(key);
    if (cur) cur.units += units;
    else this.pending.set(key, { day, module, metric, provider, units });
  }

  /** Vuelca lo acumulado. Si falla, lo devuelve a la cola para el siguiente intento (no se pierde uso medido). */
  async flush(sink: UsageSink): Promise<number> {
    if (this.pending.size === 0) return 0;
    const batch = [...this.pending.values()];
    this.pending = new Map();
    try {
      await sink.persistUsage(batch);
      return batch.length;
    } catch (e) {
      for (const b of batch) {
        const key = `${b.day}|${b.module}|${b.metric}|${b.provider}`;
        const cur = this.pending.get(key);
        if (cur) cur.units += b.units;
        else this.pending.set(key, b);
      }
      throw e;
    }
  }

  /** Vuelca periódicamente sin mantener vivo el proceso. Devuelve la función para parar (y volcar lo último). */
  autoFlush(sink: UsageSink, everyMs: number, onError: (e: unknown) => void = () => undefined): () => Promise<void> {
    const timer = setInterval(() => { this.flush(sink).catch(onError); }, everyMs);
    timer.unref();
    return async () => {
      clearInterval(timer);
      await this.flush(sink).catch(onError);
    };
  }
}

/**
 * Latencia de la API como histograma por tramos dentro del mismo medidor: 11 filas por día como máximo, sin
 * tabla nueva ni una escritura por petición. La métrica "latency_le_<ms>" cuenta respuestas de hasta ese tiempo.
 */
export const LATENCY_BUCKETS_MS = [25, 50, 100, 200, 300, 500, 1000, 2000, 5000] as const;
export const LATENCY_OVERFLOW_METRIC = "latency_gt_5000";

export function latencyMetric(ms: number): string {
  const b = LATENCY_BUCKETS_MS.find((x) => ms <= x);
  return b === undefined ? LATENCY_OVERFLOW_METRIC : `latency_le_${b}`;
}

/** Percentil desde el histograma: devuelve el límite superior del tramo que lo contiene (estimación conservadora). */
export function histogramPercentile(counts: Map<string, number>, p: number): number | null {
  const total = [...counts.values()].reduce((s, n) => s + n, 0);
  if (total === 0) return null;
  const rank = Math.ceil(p * total);
  let seen = 0;
  for (const b of LATENCY_BUCKETS_MS) {
    seen += counts.get(`latency_le_${b}`) ?? 0;
    if (seen >= rank) return b;
  }
  // Por encima del último tramo no hay techo conocido: se informa como "más de 5 s".
  return Number.POSITIVE_INFINITY;
}
