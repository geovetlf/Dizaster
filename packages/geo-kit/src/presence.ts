import type {
  AttestationVerdict,
  CategoryConfig,
  EvidenceSignatureVerdict,
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
  /** `mediaInApp` es una bonificación sobre los otros cuatro (que suman 1): nunca basta sola. */
  weights: { distance: number; accuracy: number; freshness: number; attestation: number; mediaInApp: number };
  penalties: { mockLocation: number; clockSkew: number; implausibleMovement: number };
  accuracyGoodM: number;
  accuracyMaxM: number;
  freshnessGoodS: number;
  freshnessMaxS: number;
  clockSkewToleranceS: number;
  /** Foto/video de la cámara de la app: bonificación completa hasta `good` segundos del reporte, cero en `max`. */
  mediaGoodS: number;
  mediaMaxS: number;
  maxPlausibleSpeedMps: number;
  bands: { high: number; medium: number };
  /**
   * Testimonio tardío (§8.3, ADR 0108): un reporte offline enviado fuera de la tolerancia multiplica su puntuación
   * por este factor y no pasa de MEDIUM, así nunca cuenta como corroboración independiente. Sin valor (reglas
   * anteriores a presence-3), no se descuenta.
   */
  lateOfflineFactor?: number;
  /**
   * presence-4 (ADR 0129): un envío offline sin firma válida del dispositivo no conserva la tolerancia de retraso
   * (se trata como testimonio tardío), y una firma que no corresponde a lo enviado resta esta penalización.
   */
  signedEvidence?: { requireForOffline: boolean; invalidPenalty: number };
}

export const PRESENCE_RULES_V1: PresenceRuleSet = {
  version: "presence-1",
  weights: { distance: 0.4, accuracy: 0.2, freshness: 0.2, attestation: 0.2, mediaInApp: 0 },
  penalties: { mockLocation: 0.8, clockSkew: 0.2, implausibleMovement: 0.4 },
  accuracyGoodM: 50,
  accuracyMaxM: 500,
  freshnessGoodS: 120,
  freshnessMaxS: 1800,
  clockSkewToleranceS: 300,
  mediaGoodS: 300,
  mediaMaxS: 1800,
  maxPlausibleSpeedMps: 90, // ~324 km/h: por encima es un "teletransporte"
  bands: { high: 0.75, medium: 0.5 },
};

/** presence-2 (ADR 0073): igual que presence-1 más la bonificación por media capturada en la app (§8.2, w5). */
export const PRESENCE_RULES_V2: PresenceRuleSet = {
  ...PRESENCE_RULES_V1,
  version: "presence-2",
  weights: { ...PRESENCE_RULES_V1.weights, mediaInApp: 0.1 },
};

/** presence-3 (ADR 0108): igual que presence-2 más el descuento del testimonio tardío (§8.3). */
export const PRESENCE_RULES_V3: PresenceRuleSet = {
  ...PRESENCE_RULES_V2,
  version: "presence-3",
  lateOfflineFactor: 0.5,
};

/** presence-4 (ADR 0129): igual que presence-3 más la firma en el dispositivo de la evidencia offline (§8.3, C-04). */
export const PRESENCE_RULES_V4: PresenceRuleSet = {
  ...PRESENCE_RULES_V3,
  version: "presence-4",
  signedEvidence: { requireForOffline: true, invalidPenalty: 1 },
};

export const PRESENCE_RULES_CURRENT = PRESENCE_RULES_V4;

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
  /**
   * Fotos/videos adjuntos que la app dice haber capturado con su cámara: hora de captura declarada y hora en que
   * el servidor vio por primera vez la subida. Sin firma de la app (pendiente de App Attest / Play Integrity), por
   * eso la bonificación es pequeña y no rompe los topes de radio ni de atestación.
   */
  mediaProofs?: { capturedAt: Date; serverSeenAt: Date }[];
  /** Firma de la captura verificada en el servidor (ADR 0129). Sin valor: ABSENT. */
  evidenceSignature?: EvidenceSignatureVerdict;
}

export interface PresenceResult {
  score: number;
  band: PresenceBand;
  reasons: PresenceRejectionReason[];
  fixToPinM: number;
  breakdown: PresenceBreakdown;
  ruleVersion: string;
  /** Reporte offline enviado fuera de la tolerancia: solo testimonio tardío (no crea pin). */
  lateOffline: boolean;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
/** 1 hasta `good`, decae linealmente hasta 0 en `max`. */
const ramp = (value: number, good: number, max: number) => (value <= good ? 1 : clamp01(1 - (value - good) / (max - good)));

/** Factores guardados con cada reporte (auditoría): bastan para recalcular la puntuación sin la ubicación precisa. */
export interface PresenceBreakdown {
  distance: number; accuracy: number; freshness: number; attestation: number; mediaInApp: number; penalty: number; lateOfflineFactor?: number;
}

/**
 * Puntuación final desde los factores y las reglas, con los mismos topes que al puntuar:
 * - fuera del radio no llega a MEDIUM;
 * - sin integridad de app verificada (factor < 1) no llega a HIGH;
 * - un testimonio tardío se descuenta y tampoco llega a HIGH.
 */
export function scoreFromBreakdown(b: PresenceBreakdown, rules: PresenceRuleSet): number {
  const w = rules.weights;
  const raw = w.distance * b.distance + w.accuracy * b.accuracy + w.freshness * b.freshness + w.attestation * b.attestation + w.mediaInApp * b.mediaInApp;
  // Fuera del radio el reporte no puede afirmar presencia, aunque el resto de señales sean perfectas.
  let score = clamp01(b.distance === 0 ? Math.min(raw - b.penalty, rules.bands.medium - 0.01) : raw - b.penalty);
  // Sin integridad de app verificada no se alcanza HIGH: el reporte puede sumarse a un evento, pero no crearlo solo.
  if (b.attestation !== 1) score = Math.min(score, rules.bands.high - 0.01);
  if (b.lateOfflineFactor !== undefined) score = Math.min(score * b.lateOfflineFactor, rules.bands.high - 0.01);
  return score;
}

export const bandOf = (score: number, rules: PresenceRuleSet): PresenceBand =>
  score >= rules.bands.high ? "HIGH" : score >= rules.bands.medium ? "MEDIUM" : "LOW";

export function computePresence(input: PresenceInput, rules: PresenceRuleSet = PRESENCE_RULES_CURRENT): PresenceResult {
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

  const fMedia = mediaFactor(input, rules);

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

  const signature = input.evidenceSignature ?? "ABSENT";
  if (rules.signedEvidence && signature === "INVALID") {
    penalty += rules.signedEvidence.invalidPenalty;
    reasons.push("DEVICE_SIGNATURE_INVALID");
  }

  if (hasImplausibleMovement(signals, rules.maxPlausibleSpeedMps)) {
    penalty += rules.penalties.implausibleMovement;
    reasons.push("IMPLAUSIBLE_MOVEMENT");
  }

  let lateOffline = false;
  if (input.capturedOffline) {
    const delayMin = (input.receivedAt.getTime() - input.capturedAt.getTime()) / 60000;
    if (delayMin > category.offlineToleranceMinutes) {
      lateOffline = true;
      reasons.push("LATE_OFFLINE_SUBMISSION");
    } else if (rules.signedEvidence?.requireForOffline && signature !== "VALID") {
      // Sin firma de la captura, "estaba sin conexión" es solo una afirmación: vale como testimonio tardío.
      lateOffline = true;
      reasons.push("UNSIGNED_OFFLINE_EVIDENCE");
    }
  }
  const discountLate = lateOffline && rules.lateOfflineFactor !== undefined;
  const breakdown: PresenceBreakdown = {
    distance: fDistance, accuracy: fAccuracy, freshness: fFreshness, attestation: fAttestation, mediaInApp: fMedia, penalty,
    ...(discountLate ? { lateOfflineFactor: rules.lateOfflineFactor! } : {}),
  };
  const score = scoreFromBreakdown(breakdown, rules);
  const band = bandOf(score, rules);
  return {
    score: Math.round(score * 1000) / 1000,
    band,
    reasons,
    fixToPinM: Math.round(fixToPinM),
    breakdown,
    ruleVersion: rules.version,
    lateOffline,
  };
}

/**
 * La mejor prueba de media: 1 si se capturó a ≤ `mediaGoodS` del reporte, decae hasta `mediaMaxS`. Una prueba
 * incoherente no cuenta: el servidor no pudo ver la subida antes de que la foto existiera, y en un envío en línea la
 * foto tiene que ser reciente respecto de la hora del servidor (no vale una foto vieja con fecha retocada).
 */
function mediaFactor(input: PresenceInput, rules: PresenceRuleSet): number {
  let best = 0;
  for (const m of input.mediaProofs ?? []) {
    const takenMs = m.capturedAt.getTime();
    if (m.serverSeenAt.getTime() < takenMs - rules.clockSkewToleranceS * 1000) continue;
    if (!input.capturedOffline && Math.abs(input.receivedAt.getTime() - takenMs) / 1000 > rules.mediaMaxS) continue;
    const gapS = Math.abs(input.capturedAt.getTime() - takenMs) / 1000;
    best = Math.max(best, ramp(gapS, rules.mediaGoodS, rules.mediaMaxS));
  }
  return best;
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

/** Reglas de presencia por versión: una revisión posterior usa las mismas reglas con las que se puntuó. */
export const PRESENCE_RULES_BY_VERSION: Readonly<Record<string, PresenceRuleSet>> = Object.fromEntries(
  [PRESENCE_RULES_V1, PRESENCE_RULES_V2, PRESENCE_RULES_V3, PRESENCE_RULES_V4].map((r) => [r.version, r]),
);

/**
 * La media que sostenía la bonificación "capturada en la app" resultó rechazada (ADR 0121): se recalcula desde los
 * factores guardados sin esa bonificación (entera: conservador, no se reconstruye con el resto de fotos). Mismos
 * topes que al puntuar; la puntuación solo puede bajar. NO AI REQUIRED.
 */
export function withoutMediaBonus(b: PresenceBreakdown, rules: PresenceRuleSet): { score: number; band: PresenceBand; breakdown: PresenceBreakdown } {
  const breakdown = { ...b, mediaInApp: 0 };
  const score = Math.round(Math.min(scoreFromBreakdown(b, rules), scoreFromBreakdown(breakdown, rules)) * 1000) / 1000;
  return { score, band: bandOf(score, rules), breakdown };
}
