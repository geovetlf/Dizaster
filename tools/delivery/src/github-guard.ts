/**
 * Guardas de GitHub antes de entregar (ADR 0303 y 0306). `deliver.yml` lee con el token del propio workflow las reglas
 * efectivas de `main`, el entorno `staging` y, si se va a promover, `production`, y se detiene si falta alguna
 * protección: una imagen solo sale de un `main` que exige PR y CI, los dos entornos solo aceptan ramas protegidas, y
 * producción solo arranca con la aprobación de un owner que ningún administrador puede saltarse. Sin red: recibe lo
 * que devolvió la API (`GET /repos/{repo}/rules/branches/main` y `GET /repos/{repo}/environments/{nombre}`).
 *
 * Cada lectura termina en uno de tres estados, y los hallazgos dicen cuál:
 * - verificada: la API respondió y la configuración cumple (sin hallazgo);
 * - `incorrect`: la API respondió y falta una protección, o el entorno no existe;
 * - `unverifiable`: la API no respondió (permisos, red, respuesta inválida). También detiene la entrega.
 */
export interface GuardFinding { severity: "block"; kind: "incorrect" | "unverifiable"; where: string; message: string }

/** Lo que el workflow pudo leer: el cuerpo, que el recurso no existe (404) o que no se pudo leer. */
export type ApiRead = { ok: true; body: unknown } | { ok: false; missing: true } | { ok: false; missing: false; error: string };

interface BranchRule { type: string; parameters?: { required_status_checks?: { context: string; integration_id?: number }[] } }
interface Environment {
  can_admins_bypass?: boolean;
  protection_rules?: { type: string; reviewers?: { type: string; reviewer?: { login?: string } }[] }[];
  deployment_branch_policy?: { protected_branches?: boolean; custom_branch_policies?: boolean } | null;
}

/** Checks obligatorios declarados en `.github/rulesets/main.json`, la fuente de verdad versionada. */
export function requiredChecksOf(ruleset: { rules?: BranchRule[] }): string[] {
  return (ruleset.rules ?? []).flatMap((r) => r.type === "required_status_checks" ? (r.parameters?.required_status_checks ?? []).map((c) => c.context) : []);
}

/**
 * Convierte la salida de `gh api` en un `ApiRead`: el cuerpo si la llamada tuvo éxito, o el mensaje de error.
 * `gh` escribe "(HTTP 404)" cuando el recurso no existe; cualquier otro error deja la lectura sin verificar.
 */
export function apiReadOf(result: { body?: string; error?: string }): ApiRead {
  if (result.error === undefined) {
    try { return { ok: true, body: JSON.parse(result.body ?? "") }; } catch { return { ok: false, missing: false, error: "respuesta que no es JSON" }; }
  }
  if (/\bHTTP 404\b/.test(result.error)) return { ok: false, missing: true };
  return { ok: false, missing: false, error: result.error.trim().split("\n")[0]!.slice(0, 200) || "error sin mensaje" };
}

export function checkGithubGuards(input: {
  /** Rama desde la que corre la entrega (`GITHUB_REF`); si se da, debe ser `refs/heads/main`. */
  ref?: string;
  branchRules: ApiRead;
  requiredChecks: string[];
  owners: string[];
  staging?: ApiRead;
  /** Solo si se va a promover. */
  production?: ApiRead;
}): GuardFinding[] {
  const findings: GuardFinding[] = [];
  const block = (where: string, message: string) => findings.push({ severity: "block", kind: "incorrect", where, message });
  const unverifiable = (where: string, error: string) =>
    findings.push({ severity: "block", kind: "unverifiable", where, message: `no se pudo verificar (${error}); se detiene por seguridad` });

  if (input.ref !== undefined && input.ref !== "refs/heads/main") block("ref", `la entrega solo corre desde main, no desde ${input.ref}`);

  const rules = input.branchRules;
  if (!rules.ok) {
    if (rules.missing) block("main", "la rama no existe");
    else unverifiable("main", rules.error);
  } else {
    const list = Array.isArray(rules.body) ? (rules.body as BranchRule[]) : [];
    const has = (type: string) => list.some((r) => r.type === type);
    for (const [type, what] of [["pull_request", "exigir PR"], ["required_status_checks", "exigir CI"], ["non_fast_forward", "impedir force-push"], ["deletion", "impedir el borrado"]] as const) {
      if (!has(type)) block("main", `la regla ${type} no está activa (${what})`);
    }
    const active = new Set(list.filter((r) => r.type === "required_status_checks").flatMap((r) => (r.parameters?.required_status_checks ?? []).map((c) => c.context)));
    if (has("required_status_checks")) {
      for (const c of input.requiredChecks) if (!active.has(c)) block("main", `el check obligatorio ${c} no se exige`);
    }
  }

  const environment = (where: string, read: ApiRead): Environment | undefined => {
    if (read.ok) return (read.body ?? {}) as Environment;
    if (read.missing) block(where, "el entorno no existe: GitHub lo crearía al vuelo sin protecciones");
    else unverifiable(where, read.error);
    return undefined;
  };
  const branchesLimited = (where: string, env: Environment) => {
    const branches = env.deployment_branch_policy;
    if (!branches || (!branches.protected_branches && !branches.custom_branch_policies)) {
      block(where, "cualquier rama puede desplegar: debe limitarse a ramas protegidas");
    }
  };

  if (input.staging) {
    const env = environment("staging", input.staging);
    if (env) branchesLimited("staging", env);
  }
  if (input.production) {
    const env = environment("production", input.production);
    if (env) {
      const reviewers = (env.protection_rules ?? []).filter((r) => r.type === "required_reviewers").flatMap((r) => r.reviewers ?? []);
      if (!reviewers.some((r) => r.type === "User" && input.owners.includes(r.reviewer?.login ?? ""))) {
        block("production", `falta un owner (${input.owners.join(", ")}) como revisor obligatorio`);
      }
      // GitHub devuelve `true` por omisión: un administrador podría desplegar sin la aprobación.
      if (env.can_admins_bypass !== false) block("production", "los administradores pueden saltarse la aprobación");
      branchesLimited("production", env);
    }
  }
  return findings;
}

/** Lo que quedó verificado cuando no hay hallazgos, en una línea. */
export function verifiedSummary(input: { staging: boolean; production: boolean }): string {
  return ["GitHub verificado: main protegida", input.staging ? "staging solo desde ramas protegidas" : null,
    input.production ? "production con aprobación obligatoria del owner y sin bypass de administradores" : null].filter(Boolean).join("; ");
}
