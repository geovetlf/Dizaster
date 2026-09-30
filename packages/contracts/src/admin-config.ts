import { z } from "zod";

/**
 * Cambios de configuración de administración (§13.1, §13.3, ADR 0219): cada uno exige un motivo y queda en un
 * historial de solo inserción con quién, cuándo, el valor anterior y el nuevo.
 */
export const AdminReason = z.string().trim().min(3).max(500);

export const CONFIG_CHANGE_KINDS = ["BUSINESS_VERIFICATION", "OFFICIAL_SCOPE", "BUDGET", "KILL_SWITCH", "PUBLISH_DELAY"] as const;
export type ConfigChangeKind = (typeof CONFIG_CHANGE_KINDS)[number];

export const ConfigChangesQuery = z.object({
  kind: z.enum(CONFIG_CHANGE_KINDS).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export interface ConfigChangeView {
  id: string;
  at: string;
  /** Quién lo cambió; null si su cuenta ya no existe. */
  actorHandle: string | null;
  kind: ConfigChangeKind;
  /** Qué se cambió: handle del negocio, clave del presupuesto, función o categoría. */
  target: string;
  previous: Record<string, unknown> | null;
  next: Record<string, unknown>;
  reason: string;
}

export interface ConfigChangesResponse {
  changes: ConfigChangeView[];
  nextCursor: string | null;
}
