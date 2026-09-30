import type { ConfigChangeView } from "@dizaster/contracts";

/**
 * Valor de configuración legible en una línea (ADR 0219): "limitUsd: 8 · period: DAILY", listas separadas por comas.
 * Sin valor anterior (primera vez): "—". NO AI REQUIRED.
 */
export function configValue(v: ConfigChangeView["previous"]): string {
  if (!v) return "—";
  return Object.entries(v)
    .map(([k, x]) => `${k}: ${Array.isArray(x) ? x.join(", ") : typeof x === "object" && x !== null ? JSON.stringify(x) : String(x)}`)
    .join(" · ");
}
