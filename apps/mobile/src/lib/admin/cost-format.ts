import type { CostDashboard } from "@dizaster/contracts";

/** US$ con los decimales que importan: céntimos normalmente, más precisión para importes minúsculos. */
export function formatUsd(n: number | null, lang: "es" | "en"): string | null {
  if (n === null) return null;
  const digits = n !== 0 && Math.abs(n) < 0.01 ? 4 : 2;
  return `US$ ${n.toLocaleString(lang === "es" ? "es-PE" : "en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function formatBytes(n: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatUnits(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}G`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n * 100) / 100);
}

/** Filas del tablero por módulo: primero lo que cuesta; entre lo gratuito, lo más usado. */
export function moduleRows(d: Pick<CostDashboard, "modules">): { module: string; usd: number; units: number; metrics: number }[] {
  return d.modules
    .map((m) => ({ module: m.module, usd: m.estimatedUsd, units: m.metrics.reduce((s, x) => s + x.units, 0), metrics: m.metrics.length }))
    .sort((a, b) => b.usd - a.usd || b.units - a.units || a.module.localeCompare(b.module));
}

/** Color del presupuesto según el umbral cruzado (50/80/100 %, Blueprint §12.2). */
export function budgetTone(percent: number | null): "ok" | "warn" | "high" | "over" {
  if (percent === null || percent < 50) return "ok";
  if (percent < 80) return "warn";
  if (percent < 100) return "high";
  return "over";
}

/** Altura relativa (0–1) de cada día para un gráfico de barras simple, sin librerías. */
export function barHeights(values: number[]): number[] {
  const max = Math.max(0, ...values);
  return values.map((v) => (max > 0 ? v / max : 0));
}
