import type {
  AttestationVerdict,
  CategoryConfig,
  GeoPoint,
  PresenceBand,
  PresenceRejectionReason,
  PresenceSignals,
} from "@dizaster/contracts";
import { distanceMeters } from "./distance.js";

/**
 * Reglas de presencia versionadas. Los pesos y umbrales son configuración (se calibran con datos reales);
 * cambiar cualquier valor exige una versión nueva para que cada reporte sea auditable.
 */
export interface PresenceRuleSet {
  version: string;
  weights: { distance: number; accuracy: number; freshness: number; attestation: number };
  penalties: { mockLocation: number; clockSkew: number; implausibleMovement: number };
  accuracyGoodM: number;
  accuracyMaxM: number;
  freshnessGoodS: number;
  freshnessMaxS: number;
  clockSkewToleranceS: number;
  maxPlausibleSpeedMps: number;
  bands: { high: number; medium: number };
}

export const PRESENCE_RULES_V1: PresenceRuleSet = {
  version: "presence-1",
  weights: { distance: 0.4, accuracy: 0.2, freshness: 0.2, attestation: 0.2 },
  penalties: { mockLocation: 0.8, clockSkew: 0.2, implausibleMovement: 0.4 },
  accuracyGoodM: 50,
  accuracyMaxM: 500,
  freshnessGoodS: 120,
  freshnessMaxS: 1800,
  clockSkewToleranceS: 300,
  maxPlausibleSpeedMps: 90, // ~324 km/h: por encima es un "teletransporte"
  bands: { high: 0.75, medium: 0.5 },
};

export interface PresenceInput {
  pin: GeoPoint;
  signals: PresenceSignals;
  category: Pick<CategoryConfig, "presenceRadiusM" | "offlineToleranceMinutes">;
  capturedAt: Date;
  capturedOffline: boolean;
  /** Hora del servidor al recibir. */
  receivedAt: Date;
  /** Veredicto verificado en el servidor (nunca el que dice el cliente). */
  attestation: AttestationVerdict;
}

export interface PresenceResult {
  score: number;
  band: PresenceBand;
  reasons: PresenceRejectionReason[];
  fixToPinM: number;
  breakdown: Record<string, number>;
  ruleVersion: string;
  /** Reporte offline enviado fuera de la tolerancia: solo testimonio tardío (no crea pin). */
  lateOffline: boolean;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
/** 1 hasta `good`, decae linealmente hasta 0 en `max`. */
const ramp = (value: number, good: number, max: number) => (value <= good ? 1 : clamp01(1 - (value - good) / (max - good)));

export function computePresence(input: PresenceInput, rules: PresenceRuleSet = PRESENCE_RULES_V1): PresenceResult {
  const { signals, pin, category } = input;
  const reasons: PresenceRejectionReason[] = [];
  const fixPoint = { lat: signals.fix.lat, lng: signals.fix.lng };
  const fixToPinM = distanceMeters(fixPoint, pin);

  // La precisión del GPS amplía la tolerancia (hasta un límite), pero no la sustituye.
  const effectiveRadius = category.presenceRadiusM + Math.min(signals.fix.accuracyM, category.presenceRadiusM);
  const fDistance = ramp(fixToPinM, effectiveRadius, effectiveRadius * 2);
  if (fDistance < 1) reasons.push("OUT_OF_RADIUS");

  const fAccuracy = ramp(signals.fix.accuracyM, rules.accuracyGoodM, rules.accuracyMaxM);
  if (fAccuracy < 0.5) reasons.push("LOW_ACCURACY");

  const fixAgeS = Math.abs(input.capturedAt.getTime() - Date.parse(signals.fix.fixTime)) / 1000;
  const fFreshness = ramp(fixAgeS, rules.freshnessGoodS, rules.freshnessMaxS);
  if (fFreshness < 0.5) reasons.push("STALE_FIX");

  const fAttestation = input.attestation === "GENUINE" ? 1 : input.attestation === "UNAVAILABLE" ? 0.5 : 0;
  if (input.attestation === "FAILED") reasons.push("ATTESTATION_FAILED");

  let penalty = 0;
  if (signals.mockLocation === true) {
    penalty += rules.penalties.mockLocation;
    reasons.push("MOCK_LOCATION");
  }

  // El reloj del dispositivo solo se compara cuando el envío es en línea.
  if (!input.capturedOffline) {
    const skewS = Math.abs(input.receivedAt.getTime() - Date.parse(signals.deviceClock)) / 1000;
    if (skewS > rules.clockSkewToleranceS) {
      penalty += rules.penalties.clockSkew;
      reasons.push("CLOCK_SKEW");
    }
  }

  if (hasImplausibleMovement(signals, rules.maxPlausibleSpeedMps)) {
    penalty += rules.penalties.implausibleMovement;
    reasons.push("IMPLAUSIBLE_MOVEMENT");
  }

  const w = rules.weights;
  const raw = w.distance * fDistance + w.accuracy * fAccuracy + w.freshness * fFreshness + w.attestation * fAttestation;
  // Fuera del radio el reporte no puede afirmar presencia, aunque el resto de señales sean perfectas.
  let score = clamp01(fDistance === 0 ? Math.min(raw - penalty, rules.bands.medium - 0.01) : raw - penalty);
  // Sin integridad de app verificada no se alcanza HIGH: el reporte puede sumarse a un evento, pero no crearlo solo.
  if (input.attestation !== "GENUINE") score = Math.min(score, rules.bands.high - 0.01);

  let lateOffline = false;
  if (input.capturedOffline) {
    const delayMin = (input.receivedAt.getTime() - input.capturedAt.getTime()) / 60000;
    if (delayMin > category.offlineToleranceMinutes) {
      lateOffline = true;
      reasons.push("LATE_OFFLINE_SUBMISSION");
    }
  }

  const band: PresenceBand = score >= rules.bands.high ? "HIGH" : score >= rules.bands.medium ? "MEDIUM" : "LOW";
  return {
    score: Math.round(score * 1000) / 1000,
    band,
    reasons,
    fixToPinM: Math.round(fixToPinM),
    breakdown: { distance: fDistance, accuracy: fAccuracy, freshness: fFreshness, attestation: fAttestation, penalty },
    ruleVersion: rules.version,
    lateOffline,
  };
}

function hasImplausibleMovement(signals: PresenceSignals, maxSpeedMps: number): boolean {
  const track = [...signals.recentFixes, { lat: signals.fix.lat, lng: signals.fix.lng, fixTime: signals.fix.fixTime }]
    .map((f) => ({ p: { lat: f.lat, lng: f.lng }, t: Date.parse(f.fixTime) }))
    .sort((a, b) => a.t - b.t);
  for (let i = 1; i < track.length; i++) {
    const prev = track[i - 1]!;
    const cur = track[i]!;
    const dt = (cur.t - prev.t) / 1000;
    const d = distanceMeters(prev.p, cur.p);
    if (dt <= 0 ? d > 1000 : d / dt > maxSpeedMps && d > 1000) return true;
  }
  return false;
}
