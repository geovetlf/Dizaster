import type { OutboxLane } from "@dizaster/contracts";

/**
 * Roles del worker (ADR 0159, §4.2, §9.2). Cada rol es un bucle propio: lo urgente (carril URGENT de ingesta,
 * eventos de dominio urgentes e interactivos, entrega de avisos) nunca espera a un lote normal ni al mantenimiento.
 * Un proceso puede tener varios roles (V1: todos en uno, cada uno en su bucle) o uno solo (escalar por separado).
 * NO AI REQUIRED.
 */
export const WORKER_ROLES = ["urgent", "normal", "maintenance"] as const;
export type WorkerRole = (typeof WORKER_ROLES)[number];

/** Carriles del outbox que atiende cada rol. El mantenimiento no procesa eventos. */
export const ROLE_LANES: Record<WorkerRole, OutboxLane[]> = {
  urgent: ["urgent", "interactive"],
  normal: ["normal", "batch"],
  maintenance: [],
};

export function parseWorkerRoles(raw: string): WorkerRole[] {
  const roles = [...new Set(raw.split(",").map((r) => r.trim().toLowerCase()).filter(Boolean))];
  const unknown = roles.filter((r) => !(WORKER_ROLES as readonly string[]).includes(r));
  if (unknown.length) throw new Error(`WORKER_ROLES desconocidos: ${unknown.join(", ")}`);
  if (roles.length === 0) throw new Error("WORKER_ROLES vacío");
  return roles as WorkerRole[];
}
