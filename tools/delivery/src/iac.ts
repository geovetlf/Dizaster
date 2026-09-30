import type { CostPolicy } from "./policy.js";

/** Subconjunto de `tofu show -json plan` que se evalúa. */
export interface TofuPlan { resource_changes?: { address: string; type: string; change: { actions: string[] } }[] }
export interface IacFinding { address: string; severity: "block" | "approval"; message: string }

/**
 * Revisión determinística de un plan de OpenTofu (Blueprint §20.22, Cost Guard §20.19). Nunca se aplica un plan con
 * `block`; `approval` espera al propietario. Nada de `destroy` automático.
 */
export function checkPlan(plan: TofuPlan, cost: CostPolicy): IacFinding[] {
  const out: IacFinding[] = [];
  for (const rc of plan.resource_changes ?? []) {
    const a = rc.change.actions;
    const deletes = a.includes("delete");
    const creates = a.includes("create");
    if (deletes && cost.statefulResourceTypes.includes(rc.type)) {
      out.push({ address: rc.address, severity: "block", message: creates ? "reemplazo de un recurso con datos" : "borrado de un recurso con datos" });
    } else if (deletes) {
      out.push({ address: rc.address, severity: "approval", message: creates ? "reemplazo" : "borrado" });
    }
    if (creates && !cost.allowedResourceTypes.includes(rc.type)) {
      out.push({ address: rc.address, severity: "approval", message: `tipo ${rc.type} fuera de la lista permitida (puede generar costo)` });
    }
  }
  return out;
}

/** IAM: nada de roles primitivos ni comodines en automatización (ADR 0261). Revisa el texto HCL. */
export function checkIamHcl(hcl: string, file: string): IacFinding[] {
  const out: IacFinding[] = [];
  for (const m of hcl.matchAll(/role\s*=\s*"(roles\/(owner|editor|viewer)|[^"]*\*[^"]*)"/g)) {
    out.push({ address: file, severity: "block", message: `rol amplio no permitido: ${m[1]}` });
  }
  if (/member\s*=\s*"allUsers"|members\s*=\s*\[[^\]]*"allUsers"/.test(hcl) && !/dzd:allow-public/.test(hcl)) {
    out.push({ address: file, severity: "approval", message: "acceso público (allUsers) sin marca dzd:allow-public" });
  }
  return out;
}
