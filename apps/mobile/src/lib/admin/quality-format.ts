import type { SloKey, SloView } from "@dizaster/contracts";

/** Color de un objetivo: cumplido, fuera o sin datos para juzgar. */
export type SloTone = "ok" | "over" | "none";

export function sloTone(s: Pick<SloView, "ok">): SloTone {
  return s.ok === null ? "none" : s.ok ? "ok" : "over";
}

/** 5001 ms es como el servidor informa "más de 5 s" (no hay techo en el último tramo del histograma). */
export function formatObserved(v: number | null, unit: SloView["unit"]): string | null {
  if (v === null) return null;
  if (unit === "ms" && v > 5000) return "> 5 s";
  if (unit === "ms") return `${Math.round(v)} ms`;
  if (unit === "s") return v >= 120 ? `${(v / 60).toFixed(1)} min` : `${Math.round(v)} s`;
  return v >= 48 ? `${(v / 24).toFixed(1)} d` : `${Math.round(v * 10) / 10} h`;
}

export const SLO_LABEL_KEY: Record<SloKey, "sloApi" | "sloUrgent" | "sloModeration"> = {
  api_p95: "sloApi",
  urgent_chain_p95: "sloUrgent",
  moderation_oldest_open: "sloModeration",
};

/** Porcentaje legible de una tasa 0–1; null si no hay base. */
export function formatRate(r: number | null): string {
  return r === null ? "—" : `${Math.round(r * 1000) / 10}%`;
}
