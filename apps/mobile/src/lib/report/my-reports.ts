import type { MyReportView } from "@dizaster/contracts";
import type { MessageKey } from "../i18n";

/**
 * Líneas de "Mis reportes" (ADR 0094): estado, ubicación precisa y consultas de moderación.
 * NO AI REQUIRED.
 */
export function myReportLines(r: MyReportView, t: (k: MessageKey) => string, fmt: (iso: string) => string): string[] {
  const lines = [t(`myReportStatus_${r.status}`)];
  if (r.assertion === "NOT_OCCURRING") lines.push(t("myReportDenial"));
  if (r.preciseLocationRemovedAt) lines.push(`${t("myReportPreciseRemoved")} ${fmt(r.preciseLocationRemovedAt)}`);
  else if (r.preciseLocationRemovesAt) lines.push(`${t("myReportPreciseRemoves")} ${fmt(r.preciseLocationRemovesAt)}`);
  if (r.presenceReviews > 0) lines.push(`${t("myReportReviews")}: ${r.presenceReviews}`);
  if (r.capturedOffline) lines.push(t("myReportOffline"));
  return lines;
}

/** Se puede retirar mientras no esté retirado. */
export const canWithdraw = (r: Pick<MyReportView, "status">) => r.status !== "WITHDRAWN";
