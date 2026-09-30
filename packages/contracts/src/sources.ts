import { z } from "zod";
import type { TrustTier } from "./verification.js";

/**
 * Salud de las fuentes y pausa/reanudación desde la app de administración (§5.21, §9.2, ADR 0162).
 * Desde la app solo se pausa o se reanuda: activar una fuente nueva (PLANNED/RESEARCH) exige revisar sus términos
 * y sigue siendo del propietario por la CLI.
 */
export const SourceStatus = z.enum(["ACTIVE", "PAUSED", "PLANNED", "RESEARCH", "RETIRED"]);
export type SourceStatus = z.infer<typeof SourceStatus>;

/** OK: la última ejecución fue bien · FAILING: falla pero aún reintenta · DOWN: breaker abierto · IDLE: no se consulta. */
export const SourceHealth = z.enum(["OK", "FAILING", "DOWN", "IDLE", "UNKNOWN"]);
export type SourceHealth = z.infer<typeof SourceHealth>;

export interface AdminSourceView {
  key: string;
  name: string;
  trustTier: TrustTier;
  status: SourceStatus;
  countryScope: string[];
  urgentCapable: boolean;
  health: SourceHealth;
  consecutiveFailures: number;
  breakerOpenUntil: string | null;
  lastRunAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  /** Últimas 24 h. */
  runsOk: number;
  runsFailed: number;
  itemsNew: number;
  lastStatusChange: { from: SourceStatus; to: SourceStatus; reason: string; at: string } | null;
}
export interface AdminSourcesResponse { sources: AdminSourceView[] }

export const SetSourceStatusRequest = z.object({
  to: z.enum(["ACTIVE", "PAUSED"]),
  reason: z.string().trim().min(3).max(1000),
});
export type SetSourceStatusRequest = z.infer<typeof SetSourceStatusRequest>;

/** Clasificación de salud (NO AI REQUIRED). */
export function sourceHealth(s: { status: SourceStatus; consecutiveFailures: number; breakerOpenUntil: Date | null; lastRunAt: Date | null }, now: Date): SourceHealth {
  if (s.status !== "ACTIVE") return "IDLE";
  if (s.breakerOpenUntil && s.breakerOpenUntil > now) return "DOWN";
  if (s.consecutiveFailures > 0) return "FAILING";
  return s.lastRunAt ? "OK" : "UNKNOWN";
}
