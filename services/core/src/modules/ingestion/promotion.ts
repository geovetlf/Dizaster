import type { NormalizedItem } from "./index.js";

/**
 * Regla de promoción NORMAL → URGENT (Blueprint §9.2, ADR 0100), configurable por fuente en `config.promote`:
 * - `minSeverity`: severidad normalizada (1–5) desde la que se promueve;
 * - `keywords`: palabras del título en cualquier idioma, sin tildes ni mayúsculas, como palabra completa;
 * - `categories`: categorías (o raíces) que se promueven siempre.
 * Basta con que se cumpla una. Sin regla, nada se promueve. Solo declaraciones afirmativas: un desmentido nunca.
 * NO AI REQUIRED.
 */
export interface PromotionRule {
  minSeverity?: number;
  keywords?: string[];
  categories?: string[];
}

export function parsePromotionRule(raw: unknown): PromotionRule | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const rule: PromotionRule = {};
  if (typeof r["minSeverity"] === "number" && r["minSeverity"] >= 1 && r["minSeverity"] <= 5) rule.minSeverity = r["minSeverity"];
  if (Array.isArray(r["keywords"])) rule.keywords = r["keywords"].filter((k): k is string => typeof k === "string" && k.trim().length >= 3).map(fold);
  if (Array.isArray(r["categories"])) rule.categories = r["categories"].filter((c): c is string => typeof c === "string" && c.length > 0);
  return rule.minSeverity !== undefined || rule.keywords?.length || rule.categories?.length ? rule : null;
}

export function promoteByRule(item: Pick<NormalizedItem, "severity" | "title" | "categoryCode" | "assertion">, rawRule: unknown): boolean {
  const rule = parsePromotionRule(rawRule);
  if (!rule || item.assertion !== "OCCURRING") return false;
  if (rule.minSeverity !== undefined && item.severity !== null && item.severity >= rule.minSeverity) return true;
  if (rule.categories?.some((c) => item.categoryCode === c || item.categoryCode.startsWith(`${c}.`))) return true;
  if (rule.keywords?.length && item.title) {
    const words = new Set(Object.values(item.title).flatMap((t) => fold(t).split(/[^a-z0-9]+/)).filter(Boolean));
    if (rule.keywords.some((k) => (k.includes(" ") ? Object.values(item.title!).some((t) => ` ${fold(t).replace(/[^a-z0-9]+/g, " ")} `.includes(` ${k} `)) : words.has(k)))) return true;
  }
  return false;
}

/** Minúsculas y sin tildes, para comparar palabras entre idiomas. */
function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}
