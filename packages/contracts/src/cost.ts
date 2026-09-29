import { z } from "zod";

/**
 * Cost Optimization Layer (Blueprint §5.18 y §12): tablero de costo por módulo, presupuestos y kill switches.
 * Los importes son estimaciones con precios de referencia versionados en data/cost/prices.json, no facturas.
 */
export const BudgetPeriod = z.enum(["DAILY", "MONTHLY"]);
export type BudgetPeriod = z.infer<typeof BudgetPeriod>;

export const UpdateBudgetRequest = z.object({
  period: BudgetPeriod,
  /** Tope en USD. 0 = la función de pago no puede gastar nada. */
  limitUsd: z.number().min(0).max(1_000_000),
});
export type UpdateBudgetRequest = z.infer<typeof UpdateBudgetRequest>;

export const UpdateKillSwitchRequest = z.object({
  killed: z.boolean(),
  reason: z.string().max(200).optional(),
});
export type UpdateKillSwitchRequest = z.infer<typeof UpdateKillSwitchRequest>;

export const CostDashboardQuery = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
});

export interface CostMetricView {
  metric: string;
  provider: string;
  units: number;
  /** null: sin precio de referencia para esta métrica. */
  estimatedUsd: number | null;
}

/** Uso del AI CORE en el periodo por capacidad, proveedor y modelo (ADR 0110). Sin contenido. */
export interface AiUsageView {
  capability: string;
  provider: string;
  model: string | null;
  calls: number;
  /** Intentos en los que quien llamó siguió con su regla determinista. */
  fallbacks: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
  avgLatencyMs: number;
}

export interface CostModuleView {
  module: string;
  estimatedUsd: number;
  metrics: CostMetricView[];
}

export interface BudgetView {
  key: string;
  period: BudgetPeriod;
  limitUsd: number;
  spentUsd: number;
  /** Porcentaje usado del periodo en curso; null si el tope es 0 y no hubo gasto. */
  percent: number | null;
  killed: boolean;
}

export interface KillSwitchView {
  feature: string;
  killed: boolean;
  reason: string | null;
  /** null: nunca se tocó (interruptor conocido, encendido). */
  updatedAt: string | null;
}

export interface CostDashboard {
  period: { from: string; to: string; days: number };
  generatedAt: string;
  pricesVersion: string;
  /** Cuentas con actividad en el periodo. */
  activeUsers: number;
  estimatedUsd: {
    /** Uso medido en el periodo (peticiones, push, ingestión...) más gasto real registrado por presupuestos. */
    variable: number;
    /** Almacenamiento (media + base de datos) prorrateado al periodo. */
    storage: number;
    /** Costes fijos prorrateados; null mientras no haya proveedor aprobado. */
    fixed: number | null;
    total: number;
  };
  /** Indicador principal del Blueprint §12.2. null sin usuarios activos. */
  costPer1000ActiveUsers: number | null;
  gauges: { databaseBytes: number; mediaStoredBytes: number };
  modules: CostModuleView[];
  daily: { day: string; requests: number; estimatedUsd: number }[];
  budgets: BudgetView[];
  killSwitches: KillSwitchView[];
  ai: AiUsageView[];
}

/**
 * Degradación automática por costo fuera de IA (Blueprint §6.2, §12.2; ADR 0138; orden decidido por el propietario).
 * Presupuesto `infra`: costo variable estimado más almacenamiento del periodo. Al cruzar cada escalón se apaga su
 * función; si el gasto baja (nuevo periodo o presupuesto mayor), vuelve sola. Reportes, alertas, números de
 * emergencia y fuentes urgentes nunca están en la escalera.
 */
export const INFRA_BUDGET_KEY = "infra";
export const INGESTION_NORMAL_KILL_SWITCH = "ingestion-normal";
export const DEGRADATION_LADDER: readonly { atPercent: number; feature: string }[] = [
  { atPercent: 100, feature: "video" },
  { atPercent: 110, feature: "media-upload" },
  { atPercent: 125, feature: INGESTION_NORMAL_KILL_SWITCH },
];
