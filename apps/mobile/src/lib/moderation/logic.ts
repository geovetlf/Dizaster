import type { FlagReason, FlagTargetType, ModerationActionType } from "@dizaster/contracts";

/** Motivos en el orden en que se muestran: primero los que ponen en riesgo a personas. */
export const FLAG_REASONS: FlagReason[] = ["PRIVACY", "VIOLENCE", "HARASSMENT", "ILLEGAL", "FALSE_INFO", "SPAM", "OTHER"];

/** Acciones disponibles por tipo de objeto (igual que el servidor; este lo vuelve a validar). */
const ACTIONS: Record<FlagTargetType, ModerationActionType[]> = {
  POST: ["HIDE", "REMOVE", "LIMIT", "RESTORE", "WARN_USER", "SUSPEND_USER", "UNSUSPEND_USER", "DISMISS"],
  COMMENT: ["HIDE", "REMOVE", "RESTORE", "WARN_USER", "SUSPEND_USER", "UNSUSPEND_USER", "DISMISS"],
  PROFILE: ["WARN_USER", "SUSPEND_USER", "UNSUSPEND_USER", "DISMISS"],
  BUSINESS: ["REMOVE", "RESTORE", "WARN_USER", "SUSPEND_USER", "UNSUSPEND_USER", "DISMISS"],
  EVENT: ["MARK_DISPUTED", "DISMISS"],
};
export const actionsFor = (type: FlagTargetType) => ACTIONS[type];

/** Acciones que afectan a una persona o retiran contenido: la app pide confirmación antes de aplicarlas. */
export const isSevere = (a: ModerationActionType) => a === "REMOVE" || a === "SUSPEND_USER";

/** El servidor exige un motivo de al menos 10 caracteres (lo verá la persona afectada). */
export const validReason = (s: string) => s.trim().length >= 10 && s.trim().length <= 1000;

/** Se puede bloquear a quien firma con nombre y no es uno mismo. Los seudónimos no exponen a nadie que bloquear. */
export function canBlock(author: { pseudonymous: boolean; handle?: string }, myHandle: string | null): boolean {
  return !author.pseudonymous && !!author.handle && author.handle.toLowerCase() !== myHandle?.toLowerCase();
}

/** Resumen de motivos de un caso: "Privacidad 4 · Spam 1", de más a menos denuncias. */
export function reasonSummary(reasons: Partial<Record<FlagReason, number>>, label: (r: FlagReason) => string): string {
  return (Object.entries(reasons) as [FlagReason, number][])
    .sort((a, b) => b[1] - a[1] || FLAG_REASONS.indexOf(a[0]) - FLAG_REASONS.indexOf(b[0]))
    .map(([r, n]) => `${label(r)} ${n}`)
    .join(" · ");
}
