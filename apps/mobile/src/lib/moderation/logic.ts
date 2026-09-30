import type { FlagReason, FlagTargetType, ModerationActionType, PresenceReview } from "@dizaster/contracts";

/** Motivos en el orden en que se muestran: primero los que ponen en riesgo a personas. */
export const FLAG_REASONS: FlagReason[] = ["PRIVACY", "VIOLENCE", "HARASSMENT", "ILLEGAL", "FALSE_INFO", "SPAM", "OTHER"];

/** Acciones disponibles por tipo de objeto (igual que el servidor; este lo vuelve a validar). */
const ACTIONS: Record<FlagTargetType, ModerationActionType[]> = {
  POST: ["APPROVE_MEDIA", "MARK_GRAPHIC", "HIDE", "REMOVE", "LIMIT", "RESTORE", "WARN_USER", "SUSPEND_USER", "UNSUSPEND_USER", "DISMISS"],
  COMMENT: ["HIDE", "REMOVE", "RESTORE", "WARN_USER", "SUSPEND_USER", "UNSUSPEND_USER", "DISMISS"],
  PROFILE: ["REMOVE_AVATAR", "CLEAR_PROFILE_TEXT", "WARN_USER", "SUSPEND_USER", "UNSUSPEND_USER", "DISMISS"],
  BUSINESS: ["REMOVE", "RESTORE", "REMOVE_AVATAR", "WARN_USER", "SUSPEND_USER", "UNSUSPEND_USER", "DISMISS"],
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

/**
 * Evidencia de presencia en líneas para la pantalla del caso (ADR 0089). La ubicación precisa se muestra con 5
 * decimales (~1 m) solo si aún existe. NO AI REQUIRED.
 */
export function presenceLines(v: PresenceReview, t: (k: "presenceBandLine" | "presencePrecise" | "presenceGeneralized" | "presencePrior" | "presenceMediaProof") => string): string[] {
  const fill = (s: string, p: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(p[k] ?? ""));
  const lines = [
    fill(t("presenceBandLine"), {
      band: v.presenceBand, score: Math.round(v.presenceScore * 100) / 100, distance: Math.round(v.fixToPinM), attestation: v.attestationVerdict,
    }),
  ];
  if (v.mockLocation) lines.push("MOCK_LOCATION");
  if (v.reasons.length) lines.push(v.reasons.join(", "));
  lines.push(v.deviceFix
    ? fill(t("presencePrecise"), { lat: v.deviceFix.lat.toFixed(5), lng: v.deviceFix.lng.toFixed(5), until: v.preciseExpiresAt.slice(0, 10) })
    : t("presenceGeneralized"));
  if (v.priorAccesses > 0) lines.push(fill(t("presencePrior"), { n: v.priorAccesses }));
  // Pruebas de captura (ADR 0181): cada medio de cámara y cuánto antes del reporte se tomó.
  for (const m of v.mediaCaptureProofs) lines.push(fill(t("presenceMediaProof"), { kind: m.kind, s: m.secondsBeforeReport }));
  return lines;
}
