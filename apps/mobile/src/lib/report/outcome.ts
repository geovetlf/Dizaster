import type { SubmitReportResponse } from "@dizaster/contracts";
import type { MessageKey } from "../i18n";

/**
 * Qué decirle a quien reporta (Blueprint §8.2): el resultado y, si bajó a publicación o se rechazó, qué pasó y qué
 * puede hacer. Una línea por motivo, sin repetir; un motivo desconocido (servidor más nuevo) no rompe nada.
 */
export function outcomeLines(r: SubmitReportResponse, t: (k: MessageKey) => string): string[] {
  switch (r.outcome) {
    case "CREATED_EVENT": return [t("created")];
    case "ATTACHED_TO_EVENT": return [t("attached")];
    case "DOWNGRADED_TO_POST":
      return [t("downgraded"), ...[...new Set(r.reasons)].map((x) => t(`why_${x}` as MessageKey)).filter((l): l is string => typeof l === "string" && l.length > 0)];
    case "REJECTED": {
      const hint: string | undefined = r.code ? t(`rejected_${r.code}` as MessageKey) : undefined;
      return [t("rejected"), hint || r.reason];
    }
  }
}
