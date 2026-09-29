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

export const TRUST_RULES_VERSION = "trust-1";

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
} as const;

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
