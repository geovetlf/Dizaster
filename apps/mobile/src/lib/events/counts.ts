import type { EventSummary } from "@dizaster/contracts";
import type { MessageKey } from "../i18n";

/**
 * Recuento de la cabecera del evento (§10.1, ADR 0117): "12 reportes · 2 fuentes externas · 1 fuente oficial".
 * Las externas son el total de fuentes menos las oficiales; una parte en cero no se muestra (salvo los reportes).
 * NO AI REQUIRED.
 */
export function evidenceCounts(
  e: Pick<EventSummary, "reportCount" | "sourceCount"> & { officialSourceCount?: number },
  count: (n: number, one: MessageKey, other: MessageKey) => string,
): string[] {
  const official = Math.max(0, Math.min(e.officialSourceCount ?? 0, e.sourceCount));
  const external = e.sourceCount - official;
  return [
    count(e.reportCount, "report_one", "reports"),
    ...(external > 0 ? [count(external, "externalSource_one", "externalSources")] : []),
    ...(official > 0 ? [count(official, "officialSource_one", "officialSources")] : []),
  ];
}
