import type { Lang, SubmitReportResponse } from "@dizaster/contracts";
import type { MessageKey } from "../i18n";

/**
 * Qué decirle a quien reporta (Blueprint §8.2): el resultado y, si bajó a publicación o se rechazó, qué pasó y qué
 * puede hacer. Una línea por motivo, sin repetir; un motivo desconocido (servidor más nuevo) no rompe nada.
 */
export function outcomeLines(r: SubmitReportResponse, t: (k: MessageKey) => string, fmtTime: (iso: string) => string = (iso) => iso, lang: Lang = "es"): string[] {
  // Retraso de publicación (ADR 0099): por seguridad, su publicación espera hasta esa hora.
  const delayed = (r.outcome === "CREATED_EVENT" || r.outcome === "ATTACHED_TO_EVENT") && r.publishAfter ? [`${t("publishDelayed")} ${fmtTime(r.publishAfter)}`] : [];
  switch (r.outcome) {
    case "CREATED_EVENT": return [t("created"), ...delayed];
    case "ATTACHED_TO_EVENT": return [t("attached"), ...delayed];
    case "DOWNGRADED_TO_POST":
      return [t("downgraded"), ...[...new Set(r.reasons)].map((x) => t(`why_${x}` as MessageKey)).filter((l): l is string => typeof l === "string" && l.length > 0)];
    case "REJECTED": {
      const hint: string | undefined = r.code ? t(`rejected_${r.code}` as MessageKey) : undefined;
      // El motivo del servidor viene en español: solo se muestra en español y cuando el código no se conoce
      // (servidor más nuevo). En otro idioma basta «Reporte rechazado» (ADR 0281).
      if (hint) return [t("rejected"), hint];
      return lang === "es" && r.reason ? [t("rejected"), r.reason] : [t("rejected")];
    }
  }
}
