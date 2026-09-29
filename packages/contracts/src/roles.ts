/**
 * Roles y permisos (Blueprint §13.1, ADR 0101). Una sola tabla, compartida por servidor y app: el servidor decide,
 * la app solo muestra lo que el rol puede usar. Mínimo privilegio: cada rol ve solo sus herramientas.
 * NO AI REQUIRED.
 */
export const STAFF_ROLES = ["moderator", "verifier", "operator", "admin"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
export type Role = "user" | StaffRole;

export const PERMISSIONS = {
  /** Casos, apelaciones y consulta de presencia con motivo. */
  "content.moderate": ["moderator", "admin"],
  /** Herramientas de EVENT: fusionar, dividir, revertir, ciclo de vida, disputa/falsedad y duplicados. */
  "event.verify": ["verifier", "moderator", "admin"],
  /** Tableros de costo y calidad (solo lectura). */
  "ops.view": ["operator", "admin"],
  /** Kill switches (apagar o encender funciones con costo; el gasto sigue topado por los presupuestos). */
  "ops.control": ["operator", "admin"],
  /** Presupuestos, sellos de negocio, ámbito institucional y registro de consultas de presencia. */
  "admin": ["admin"],
} as const satisfies Record<string, readonly StaffRole[]>;
export type Permission = keyof typeof PERMISSIONS;

export function can(roles: readonly string[], permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly string[]).some((r) => roles.includes(r));
}

export function isStaff(roles: readonly string[]): boolean {
  return STAFF_ROLES.some((r) => roles.includes(r));
}

export function isStaffRole(v: string): v is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(v);
}
