/**
 * Reglas de reputación (Blueprint §13.3). Puras y deterministas: la reputación nunca se muestra como número;
 * solo decide cuánto pesa una persona al corroborar, cuántos reportes puede enviar y cuánto pesan sus denuncias.
 */
export type TrustTier = "NEW" | "LOW" | "STANDARD" | "TRUSTED";

export interface ReputationSignals {
  accountAgeHours: number;
  /** Reportes en eventos que terminaron corroborados o confirmados (o desmentidos, si el reporte negaba). */
  corroborated: number;
  /** Reportes que afirmaban algo que una fuente oficial o moderación declaró FALSE. */
  falseReports: number;
  /** Sanciones de moderación de los últimos 90 días no revertidas en apelación. */
  removals: number;
  suspensions: number;
}

export const TRUST_RULES_VERSION = "trust-3";

export const TRUST = {
  newAccountHours: 24,
  trustedMinAgeDays: 30,
  trustedMinCorroborated: 5,
  lowMinFalse: 2,
  lowMinRemovals: 2,
  sanctionWindowDays: 90,
  /** Cuentas jóvenes que co-reportaron en tantos otros eventos recientes se tratan como un solo grupo. */
  coordinationMaxAgeDays: 30,
  coordinationMinSharedEvents: 2,
  coordinationWindowDays: 7,
  /**
   * Cuentas jóvenes creadas con menos de estos minutos de diferencia (§10.2 "cuentas nuevas creadas juntas", ADR
   * 0142): basta UN evento previo en común para tratarlas como grupo. Solas no se enlazan: con muchas altas por día
   * (y en un desastre, todas a la vez) coincidir en el minuto de alta no dice nada por sí mismo.
   */
  coordinationCreatedTogetherMinutes: 10,
} as const;

/**
 * Pares de cuentas jóvenes que se tratan como grupo (ADR 0031, 0142): co-reportaron en suficientes otros eventos, o
 * en al menos uno si además se crearon con pocos minutos de diferencia. `ageHours`: edad de cada cuenta. NO AI REQUIRED.
 */
export function coordinationLinks(
  pairs: { a: string; b: string; sharedEvents: number }[], ageHours: Map<string, number>,
  rules: { minShared: number; togetherMinutes: number } = { minShared: TRUST.coordinationMinSharedEvents, togetherMinutes: TRUST.coordinationCreatedTogetherMinutes },
): [string, string][] {
  return pairs
    .filter((p) => p.sharedEvents >= rules.minShared
      || (p.sharedEvents >= 1 && Math.abs((ageHours.get(p.a) ?? -1e9) - (ageHours.get(p.b) ?? 1e9)) * 60 <= rules.togetherMinutes))
    .map((p): [string, string] => [p.a, p.b]);
}

/** Peso al corroborar. Dos personas TRUSTED con presencia alta alcanzan el umbral 3 (Blueprint §9, "2 HIGH + reputación alta"). */
export const TIER_WEIGHT: Record<TrustTier, number> = { NEW: 0.5, LOW: 0.25, STANDARD: 1, TRUSTED: 1.5 };

export function tierFor(s: ReputationSignals): TrustTier {
  // Lo negativo pesa antes que la antigüedad: una cuenta vieja sancionada no se "lava" con el tiempo.
  if (s.suspensions > 0 || s.removals >= TRUST.lowMinRemovals) return "LOW";
  if (s.falseReports >= TRUST.lowMinFalse && s.falseReports >= s.corroborated) return "LOW";
  if (s.accountAgeHours < TRUST.newAccountHours) return "NEW";
  if (
    s.accountAgeHours >= TRUST.trustedMinAgeDays * 24 &&
    s.corroborated >= TRUST.trustedMinCorroborated &&
    s.falseReports === 0 &&
    s.removals === 0
  ) return "TRUSTED";
  return "STANDARD";
}

/**
 * Reputación del teléfono (Blueprint §5.20, §8.2; ADR 0131). Ajusta el cupo, no la validez: un teléfono con una cuenta
 * suspendida o con señales repetidas de manipulación en 30 días (ubicación simulada, saltos imposibles, firma que no
 * corresponde) cuenta como LOW para cualquier cuenta que reporte desde él. Así una cuenta nueva no borra el historial.
 */
export interface PhoneSignals { suspendedAccount: boolean; tamperSignals30d: number }
export const PHONE_TAMPER_REASONS = ["MOCK_LOCATION", "IMPLAUSIBLE_MOVEMENT", "DEVICE_SIGNATURE_INVALID"] as const;
export const PHONE_TAMPER_LIMIT = 3;
const TIER_ORDER: TrustTier[] = ["LOW", "NEW", "STANDARD", "TRUSTED"];
export function withPhone(tier: TrustTier, phone: PhoneSignals | null): TrustTier {
  if (!phone) return tier;
  const flagged = phone.suspendedAccount || phone.tamperSignals30d >= PHONE_TAMPER_LIMIT;
  return flagged && TIER_ORDER.indexOf(tier) > 0 ? "LOW" : tier;
}

/**
 * Límites sociales por reputación (Blueprint §13.3, ADR 0132): cuentas nuevas o con mal historial publican y comentan
 * menos. Nunca cero: nadie queda mudo por un límite automático.
 */
export const SOCIAL_LIMITS: Record<TrustTier, { postsPerHour: number; commentsPerMinute: number }> = {
  TRUSTED: { postsPerHour: 20, commentsPerMinute: 10 },
  STANDARD: { postsPerHour: 20, commentsPerMinute: 10 },
  NEW: { postsPerHour: 10, commentsPerMinute: 5 },
  LOW: { postsPerHour: 5, commentsPerMinute: 3 },
};
/** Tope diario de reportes: este múltiplo del cupo por hora de la cuenta (ADR 0132). */
export const REPORTS_PER_DAY_FACTOR = 4;

/** Reportes por hora según la reputación: más estrictos para cuentas nuevas o con historial malo, nunca cero. */
export function reportQuota(tier: TrustTier, base: number): number {
  if (tier === "LOW") return Math.max(1, Math.floor(base / 4));
  if (tier === "NEW") return Math.max(1, Math.floor(base / 2));
  return base;
}

/**
 * Anti-coordinación: agrupa a quienes están enlazados (pares de cuentas jóvenes que ya reportaron juntas en
 * varios otros eventos recientes) y cada grupo aporta solo el mayor de sus pesos. Genuinos vecinos rara vez
 * coinciden en muchos eventos distintos en pocos días; las granjas de cuentas sí.
 */
export function coordinatedWeights(weights: Map<string, number>, links: [string, string][]): Map<string, number> {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x) ?? x;
    if (p === x) return x;
    const r = find(p);
    parent.set(x, r);
    return r;
  };
  for (const [a, b] of links) {
    if (!weights.has(a) || !weights.has(b)) continue;
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  }
  const best = new Map<string, string>();
  for (const [u, w] of [...weights.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const r = find(u);
    const cur = best.get(r);
    if (cur === undefined || w > weights.get(cur)!) best.set(r, u);
  }
  const keep = new Set(best.values());
  return new Map([...weights.entries()].map(([u, w]) => [u, keep.has(u) ? w : 0]));
}
