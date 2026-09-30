import type { Outcome } from "./policy.js";

/**
 * Niveles de autonomía (Blueprint §20.23, ADR 0262). Cada nivel hereda los permisos del anterior.
 * 0 solo humano · 1 asistencia · 2 desarrollo autónomo · 3 validación, build y merge por política ·
 * 4 staging autónomo · 5 producción por política.
 */
export const LEVELS = [
  "Solo humano", "Asistencia", "Desarrollo autónomo", "Validación y build autónomos", "Staging autónomo", "Producción por política",
] as const;

export type Action =
  | "open-pr" | "run-gates" | "merge" | "build-artifact"
  | "deploy-staging" | "migrate-staging" | "apply-infra-staging" | "rollback-staging"
  | "promote-production" | "migrate-production" | "apply-infra-production" | "rollback-production"
  | "destroy-infra" | "read-secrets" | "change-iam" | "disable-gate" | "delete-backup";

export interface Decision { allowed: boolean; needs: "none" | "review" | "owner-approval" | "forbidden"; reason: string }

/** Nivel mínimo para que la acción ocurra sin intervención humana. */
const MIN_LEVEL: Partial<Record<Action, number>> = {
  "open-pr": 2, "run-gates": 2, merge: 3, "build-artifact": 3,
  "deploy-staging": 4, "migrate-staging": 4, "apply-infra-staging": 4, "rollback-staging": 4,
  "promote-production": 5, "rollback-production": 5,
};

/** Nunca automáticas, en ningún nivel (Permission Guard). */
const FORBIDDEN: Action[] = ["read-secrets", "change-iam", "disable-gate", "delete-backup"];
/** Siempre con aprobación explícita del propietario, en cualquier nivel. */
const OWNER_ONLY: Action[] = ["destroy-infra", "migrate-production", "apply-infra-production"];

/**
 * ¿Puede el Delivery Plane hacer `action` solo? Combina el nivel vigente con el resultado de la política para el
 * cambio (`outcome`). Un rollback nunca espera a la política: devolver el tráfico a lo verificado siempre es más seguro.
 */
export function decide(level: number, action: Action, outcome: Outcome = "auto"): Decision {
  if (FORBIDDEN.includes(action)) return { allowed: false, needs: "forbidden", reason: "prohibido para la automatización en cualquier nivel" };
  if (OWNER_ONLY.includes(action)) return { allowed: false, needs: "owner-approval", reason: "siempre requiere aprobación explícita del propietario" };
  const min = MIN_LEVEL[action] ?? 6;
  if (level < min) return { allowed: false, needs: action.startsWith("rollback") ? "review" : "owner-approval", reason: `requiere nivel ${min} (${LEVELS[min] ?? "—"}); vigente: ${level}` };
  if (action.startsWith("rollback")) return { allowed: true, needs: "none", reason: "rollback de tráfico a una versión verificada" };
  if (outcome === "block") return { allowed: false, needs: "forbidden", reason: "la política bloquea este cambio" };
  if (outcome === "approval") return { allowed: false, needs: "owner-approval", reason: "cambio crítico: aprueba el propietario" };
  if (outcome === "review" && (action === "merge" || action === "promote-production")) return { allowed: false, needs: "review", reason: "la política pide revisión" };
  return { allowed: true, needs: "none", reason: `permitido en nivel ${level} (${LEVELS[level]})` };
}

/**
 * ¿Quién actúa? En local, `human` (la persona que teclea). En CI, `github:<login>` de quien disparó el workflow: solo
 * cuenta como humano si está en `owners` de la política (D-24); cualquier otro (un bot, Claude) es automatización.
 * Dentro de GitHub Actions nadie puede declararse `human` a secas.
 */
export function isHuman(actor: string, owners: string[], env: NodeJS.ProcessEnv = {}): boolean {
  if (actor === "human") return !env["GITHUB_ACTIONS"];
  const login = /^github:(.+)$/.exec(actor)?.[1];
  return login !== undefined && owners.includes(login);
}
