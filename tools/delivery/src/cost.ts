import type { CostPolicy } from "./policy.js";

/**
 * Cost Guard de delivery (Blueprint §20.19): separado del Cost Optimization Layer del producto. Cada operación
 * declara su recurso y su costo estimado; si el uso del mes más la operación supera el presupuesto, se bloquea.
 * Un recurso sin presupuesto definido vale 0: cualquier gasto en él se bloquea hasta que el propietario lo fije.
 */
export function costGate(cost: CostPolicy, used: Record<string, number>, op: { resource: string; estimate: number }): { allowed: boolean; reason: string } {
  if (op.estimate <= 0) return { allowed: true, reason: "sin costo" };
  const budget = cost.monthly[op.resource] ?? 0;
  const after = (used[op.resource] ?? 0) + op.estimate;
  if (after > budget) return { allowed: false, reason: `${op.resource}: ${after} supera el presupuesto mensual ${budget}` };
  return { allowed: true, reason: `${op.resource}: ${after} de ${budget}` };
}
