/**
 * Guardas de GitHub antes de entregar (ADR 0303). `deliver.yml` lee con el token del propio workflow las reglas
 * efectivas de `main` y, si se va a promover, el entorno `production`, y se detiene si falta alguna protección: una
 * imagen solo sale de un `main` que exige PR y CI, y producción solo con la aprobación de un owner. Sin red: recibe el
 * JSON que devuelve la API de GitHub (`GET /repos/{repo}/rules/branches/main` y `GET /repos/{repo}/environments/production`).
 */
export interface GuardFinding { severity: "block"; where: string; message: string }

interface BranchRule { type: string; parameters?: { required_status_checks?: { context: string; integration_id?: number }[] } }
interface ProductionEnvironment {
  protection_rules?: { type: string; reviewers?: { type: string; reviewer?: { login?: string } }[] }[];
  deployment_branch_policy?: { protected_branches?: boolean; custom_branch_policies?: boolean } | null;
}

/** Checks obligatorios declarados en `.github/rulesets/main.json`, la fuente de verdad versionada. */
export function requiredChecksOf(ruleset: { rules?: BranchRule[] }): string[] {
  return (ruleset.rules ?? []).flatMap((r) => r.type === "required_status_checks" ? (r.parameters?.required_status_checks ?? []).map((c) => c.context) : []);
}

export function checkGithubGuards(input: {
  branchRules: unknown;
  requiredChecks: string[];
  owners: string[];
  /** Solo si se va a promover; `null` = el entorno no existe. */
  production?: unknown;
}): GuardFinding[] {
  const findings: GuardFinding[] = [];
  const block = (where: string, message: string) => findings.push({ severity: "block", where, message });
  const rules = Array.isArray(input.branchRules) ? (input.branchRules as BranchRule[]) : [];
  const has = (type: string) => rules.some((r) => r.type === type);
  for (const [type, what] of [["pull_request", "exigir PR"], ["required_status_checks", "exigir CI"], ["non_fast_forward", "impedir force-push"], ["deletion", "impedir el borrado"]] as const) {
    if (!has(type)) block("main", `la regla ${type} no está activa (${what})`);
  }
  const active = new Set(rules.filter((r) => r.type === "required_status_checks").flatMap((r) => (r.parameters?.required_status_checks ?? []).map((c) => c.context)));
  if (has("required_status_checks")) {
    for (const c of input.requiredChecks) if (!active.has(c)) block("main", `el check obligatorio ${c} no se exige`);
  }
  if (input.production === undefined) return findings;
  const env = input.production as ProductionEnvironment | null;
  if (!env) {
    block("production", "el entorno no existe: GitHub lo crearía sin revisores");
    return findings;
  }
  const reviewers = (env.protection_rules ?? []).filter((r) => r.type === "required_reviewers").flatMap((r) => r.reviewers ?? []);
  if (!reviewers.some((r) => r.type === "User" && input.owners.includes(r.reviewer?.login ?? ""))) {
    block("production", `falta un owner (${input.owners.join(", ")}) como revisor obligatorio`);
  }
  const branches = env.deployment_branch_policy;
  if (!branches || (!branches.protected_branches && !branches.custom_branch_policies)) {
    block("production", "cualquier rama puede desplegar: debe limitarse a ramas protegidas");
  }
  return findings;
}
