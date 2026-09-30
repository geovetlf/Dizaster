import type { AdminSourceView, SourceHealth } from "@dizaster/contracts";

/** Presentación de la salud de fuentes (ADR 0162). NO AI REQUIRED. */
export const HEALTH_COLOR: Record<SourceHealth, string> = {
  OK: "#22C55E",
  FAILING: "#FACC15",
  DOWN: "#E5262E",
  IDLE: "#9AA4B2",
  UNKNOWN: "#9AA4B2",
};

/** Lo que más urge arriba: caídas, luego con fallos, luego el resto (las activas antes que las pausadas). */
const RANK: Record<SourceHealth, number> = { DOWN: 0, FAILING: 1, UNKNOWN: 2, OK: 3, IDLE: 4 };
export function sortSources(list: readonly AdminSourceView[]): AdminSourceView[] {
  return [...list].sort((a, b) => RANK[a.health] - RANK[b.health] || (b.urgentCapable ? 1 : 0) - (a.urgentCapable ? 1 : 0) || a.key.localeCompare(b.key));
}

/** Acción posible desde la app: solo pausar una activa o reanudar una pausada. */
export function sourceAction(s: Pick<AdminSourceView, "status">): "PAUSE" | "RESUME" | null {
  return s.status === "ACTIVE" ? "PAUSE" : s.status === "PAUSED" ? "RESUME" : null;
}

export function validReason(reason: string): boolean {
  return reason.trim().length >= 3;
}
