import { readFileSync } from "node:fs";
import { matchesAny } from "./glob.js";

/** Clases de riesgo de un cambio (Blueprint §20.16, ADR 0262), de menor a mayor. */
export const RISK_CLASSES = ["low", "medium", "critical", "blocked"] as const;
export type RiskClass = (typeof RISK_CLASSES)[number];
export type Environment = "staging" | "production";
/** auto: sigue solo tras gates; review: gates + revisión; approval: el propietario aprueba; block: no sigue. */
export type Outcome = "auto" | "review" | "approval" | "block";

export interface PathRule { class: RiskClass; paths: string[]; reason: string }
export interface DocRule { when: string[]; require: string[]; message: string }

export interface Policy {
  version: 1;
  autonomyLevel: number;
  default: RiskClass;
  rules: PathRule[];
  outcomes: Record<RiskClass, Record<Environment, Outcome>>;
  fullRegression: { paths: string[]; refs: string[] };
  docRules: DocRule[];
  migrations: { dir: string; derivedTables: string[] };
  cost: CostPolicy;
}

export interface CostPolicy {
  /** Presupuesto mensual por recurso, en su unidad (minutos de CI, builds de EAS, USD de nube, llamadas de IA). */
  monthly: Record<string, number>;
  /** Tipos de recurso de OpenTofu que se pueden crear sin aprobación (el resto pide aprobación: pueden costar). */
  allowedResourceTypes: string[];
  /** Recursos con estado: borrarlos o reemplazarlos se bloquea siempre. */
  statefulResourceTypes: string[];
}

export function rank(c: RiskClass): number {
  return RISK_CLASSES.indexOf(c);
}

export function maxClass(classes: Iterable<RiskClass>, floor: RiskClass = "low"): RiskClass {
  let out = floor;
  for (const c of classes) if (rank(c) > rank(out)) out = c;
  return out;
}

/** Clase de un archivo: la más alta entre las reglas que lo cubren; sin regla, la clase por defecto. */
export function classifyPath(policy: Policy, path: string): { class: RiskClass; reasons: string[] } {
  const hits = policy.rules.filter((r) => matchesAny(path, r.paths));
  if (hits.length === 0) return { class: policy.default, reasons: [] };
  const top = maxClass(hits.map((h) => h.class));
  return { class: top, reasons: hits.filter((h) => h.class === top).map((h) => h.reason) };
}

export function outcomeFor(policy: Policy, risk: RiskClass, env: Environment): Outcome {
  return policy.outcomes[risk][env];
}

/** Valida la forma de la política: una política mal escrita debe fallar, nunca quedar permisiva por omisión. */
export function validatePolicy(raw: unknown): Policy {
  const errors: string[] = [];
  const p = raw as Partial<Policy>;
  const isClass = (c: unknown): c is RiskClass => RISK_CLASSES.includes(c as RiskClass);
  const outcomes = ["auto", "review", "approval", "block"];
  if (!p || typeof p !== "object") throw new Error("Política inválida: no es un objeto");
  if (p.version !== 1) errors.push("version debe ser 1");
  if (!Number.isInteger(p.autonomyLevel) || p.autonomyLevel! < 0 || p.autonomyLevel! > 5) errors.push("autonomyLevel debe ser 0–5");
  if (!isClass(p.default)) errors.push("default debe ser una clase de riesgo");
  if (!Array.isArray(p.rules)) errors.push("rules debe ser una lista");
  for (const [i, r] of (p.rules ?? []).entries()) {
    if (!isClass(r.class)) errors.push(`rules[${i}].class inválida`);
    if (!Array.isArray(r.paths) || r.paths.length === 0) errors.push(`rules[${i}].paths vacía`);
    if (!r.reason) errors.push(`rules[${i}].reason vacía`);
  }
  for (const c of RISK_CLASSES) {
    for (const env of ["staging", "production"] as const) {
      const o = p.outcomes?.[c]?.[env];
      if (!outcomes.includes(o as string)) errors.push(`outcomes.${c}.${env} inválido`);
    }
  }
  // Invariantes que ninguna edición de la política puede romper (ADR 0262).
  if (p.outcomes?.blocked && (p.outcomes.blocked.staging !== "block" || p.outcomes.blocked.production !== "block")) {
    errors.push("la clase blocked debe dar block en todos los entornos");
  }
  if (p.outcomes?.critical && p.outcomes.critical.production !== "approval" && p.outcomes.critical.production !== "block") {
    errors.push("un cambio crítico en producción requiere approval");
  }
  if (!p.fullRegression || !Array.isArray(p.fullRegression.paths) || !Array.isArray(p.fullRegression.refs)) errors.push("fullRegression incompleta");
  if (!Array.isArray(p.docRules)) errors.push("docRules debe ser una lista");
  if (!p.migrations?.dir) errors.push("migrations.dir vacío");
  if (!p.cost || typeof p.cost.monthly !== "object") errors.push("cost.monthly vacío");
  if (errors.length) throw new Error(`Política inválida:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
  return p as Policy;
}

export function loadPolicy(path = "delivery/policy.json"): Policy {
  return validatePolicy(JSON.parse(readFileSync(path, "utf8")));
}
