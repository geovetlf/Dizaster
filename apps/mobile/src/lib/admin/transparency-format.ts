import type { TransparencyCount, TransparencyReport } from "@dizaster/contracts";

/**
 * Formato del informe de transparencia (ADR 0135, 0151). Las cifras 1–4 llegan como "<5" y nunca se suman ni se
 * convierten en un número: solo se ordenan (como 4,5) y se muestran tal cual. NO AI REQUIRED.
 */
export const countValue = (c: TransparencyCount): number => (c === "<5" ? 4.5 : c);
export const formatCount = (c: TransparencyCount | undefined): string => (c === undefined ? "0" : String(c));

/** Entradas de un desglose ordenadas de mayor a menor (desempate por clave para que sea estable). */
export function sortedCounts<K extends string>(byKey: Partial<Record<K, TransparencyCount>>): [K, TransparencyCount][] {
  return (Object.entries(byKey) as [K, TransparencyCount][])
    .filter(([, v]) => v !== 0)
    .sort((a, b) => countValue(b[1]) - countValue(a[1]) || a[0].localeCompare(b[0]));
}

export function sortedActions(actions: TransparencyReport["actions"]): TransparencyReport["actions"] {
  return actions.filter((a) => a.count !== 0)
    .sort((a, b) => countValue(b.count) - countValue(a.count) || a.action.localeCompare(b.action) || a.actor.localeCompare(b.actor));
}

export const formatHours = (h: number | null): string => (h === null ? "—" : h >= 48 ? `${(h / 24).toFixed(1)} d` : `${Math.round(h * 10) / 10} h`);

/** Etiquetas que la pantalla traduce; el texto plano sirve para compartir el informe tal cual. */
export interface TransparencyLabels {
  title: string; period: string; flags: string; cases: string; opened: string; resolved: string; dismissed: string;
  median: string; actions: string; reversals: string; appeals: string; received: string; upheld: string; reversed: string;
  open: string; authority: string; note: string;
  reason: (k: string) => string; action: (k: string) => string; actor: (k: "RULE" | "MODERATOR") => string;
  target: (k: string) => string; authorityType: (k: string) => string;
}

export function transparencyText(r: TransparencyReport, l: TransparencyLabels): string {
  const day = (iso: string) => iso.slice(0, 10);
  const lines = [
    l.title,
    `${l.period}: ${day(r.period.from)} – ${day(r.period.to)} (${r.period.days} d)`,
    "",
    `${l.flags}: ${formatCount(r.flags.total)}`,
    ...sortedCounts(r.flags.byReason).map(([k, v]) => `  ${l.reason(k)}: ${v}`),
    "",
    `${l.cases}: ${l.opened} ${formatCount(r.cases.opened)} · ${l.resolved} ${formatCount(r.cases.resolved)} · ${l.dismissed} ${formatCount(r.cases.dismissed)}`,
    `  ${l.median}: ${formatHours(r.cases.medianHoursToClose)}`,
    "",
    `${l.actions}:`,
    ...sortedActions(r.actions).map((a) => `  ${l.action(a.action)} · ${l.target(a.targetType)} · ${l.actor(a.actor)}: ${a.count}`),
    `${l.reversals}: ${formatCount(r.reversals)}`,
    "",
    `${l.appeals}: ${l.received} ${formatCount(r.appeals.received)} · ${l.upheld} ${formatCount(r.appeals.upheld)} · ${l.reversed} ${formatCount(r.appeals.reversed)} · ${l.open} ${formatCount(r.appeals.open)}`,
    "",
    `${l.authority}: ${formatCount(r.authorityRequests.received)}`,
    ...sortedCounts(r.authorityRequests.byType).map(([k, v]) => `  ${l.authorityType(k)}: ${v}`),
    "",
    l.note,
  ];
  return lines.join("\n");
}
