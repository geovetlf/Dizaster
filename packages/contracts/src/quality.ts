import { z } from "zod";

/**
 * Métricas de calidad del producto (Blueprint §14 y RNF-01/02/03): qué tan rápido, preciso y sano funciona
 * Dizaster, para administración. Solo agregados: ningún dato personal ni ubicación.
 */
export const QualityQuery = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7),
});

/** Objetivos medibles. `ok` es null cuando aún no hay datos suficientes para juzgar. */
export const SLO_KEYS = ["api_p95", "urgent_chain_p95", "moderation_oldest_open"] as const;
export type SloKey = (typeof SLO_KEYS)[number];

export interface SloView {
  key: SloKey;
  /** Umbral y valor observado en la unidad indicada. */
  target: number;
  observed: number | null;
  unit: "ms" | "s" | "h";
  ok: boolean | null;
}

export interface QualityReport {
  period: { from: string; to: string; days: number };
  generatedAt: string;
  slos: SloView[];
  api: {
    requests: number;
    /** Percentiles estimados desde un histograma por tramos: cota superior del tramo. null = sin datos. */
    p50Ms: number | null;
    p95Ms: number | null;
    p99Ms: number | null;
  };
  events: { created: number; merged: number; mergeRate: number | null };
  verification: {
    /** EVENTs que alcanzaron por primera vez cada nivel positivo en el periodo. */
    communityCorroborated: number;
    externallyCorroborated: number;
    officiallyConfirmed: number;
    disputed: number;
    markedFalse: number;
    /** Mediana de minutos desde que se creó el EVENT hasta su primera corroboración (cualquier nivel). */
    medianMinutesToCorroboration: number | null;
  };
  alerts: {
    alerts: number;
    critical: number;
    notifications: Record<string, number>;
    pushP50Seconds: number | null;
    pushP95Seconds: number | null;
    criticalPushP95Seconds: number | null;
  };
  ingestion: {
    runs: number;
    failedRuns: number;
    failureRate: number | null;
    urgentItems: number;
    /** Desde que la fuente oficial publica hasta que Dizaster lo trae (solo carril urgente). */
    urgentLagP95Seconds: number | null;
  };
  moderation: {
    openCases: number;
    oldestOpenHours: number | null;
    resolvedCases: number;
    medianResolutionHours: number | null;
    appealsDecided: number;
    appealsReversed: number;
  };
}
