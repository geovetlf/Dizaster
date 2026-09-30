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

/** Diferencia a partir de la cual se muestran por separado la hora del suceso y la de detección (ADR 0224). */
export const DETECTION_GAP_MINUTES = 15;

/**
 * Cuándo pasó (§7.3 occurred_start, ADR 0224): la hora del suceso si se conoce y, si Dizaster lo supo bastante
 * después (p. ej. un informe publicado horas más tarde), también la de detección. `fmt` formatea cada hora.
 */
export function eventWhenParts(e: { startedAt?: string | null; firstSeenAt: string }, fmt: (iso: string) => string):
  { started: string; detected: string | null } {
  const start = e.startedAt && Date.parse(e.startedAt) <= Date.parse(e.firstSeenAt) ? e.startedAt : e.firstSeenAt;
  const gap = (Date.parse(e.firstSeenAt) - Date.parse(start)) / 60_000;
  return { started: fmt(start), detected: gap >= DETECTION_GAP_MINUTES ? fmt(e.firstSeenAt) : null };
}
