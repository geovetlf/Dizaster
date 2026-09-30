import type { EventStatus } from "@dizaster/contracts";

/**
 * Estado y gravedad de un evento para el público (§7.3, §10.1, ADR 0222): "En seguimiento · Gravedad 4 de 5".
 * La gravedad sale de la evidencia activa (ADR 0160) y el estado del ciclo de vida, que es independiente de la
 * verificación. NO AI REQUIRED.
 */
export function eventStatusLine(
  e: { status: EventStatus; severity: number },
  t: (key: `st_${EventStatus}`) => string,
  tf: (key: "severityOf", params: { n: number }) => string,
): string {
  const severity = Math.min(5, Math.max(1, Math.round(e.severity)));
  return `${t(`st_${e.status}`)} · ${tf("severityOf", { n: severity })}`;
}

/** Radio del círculo en el mapa: crece con los reportes agrupados y, un poco, con la gravedad (1–5). */
export const MAP_CIRCLE_RADIUS = [
  "+",
  ["interpolate", ["linear"], ["get", "count"], 1, 7, 50, 22],
  ["*", ["-", ["coalesce", ["get", "severity"], 1], 1], 1.5],
] as const;
