import type { GeoPoint } from "@dizaster/contracts";
import { distanceMeters } from "./distance.js";

/** Reglas de deduplicación versionadas (Blueprint §8.4). */
export interface DedupRuleSet {
  version: string;
  weights: { distance: number; time: number; category: number; text: number; media?: number };
  autoAttach: number;
  ambiguous: number;
}

export const DEDUP_RULES_V1: DedupRuleSet = {
  version: "dedup-1",
  weights: { distance: 0.45, time: 0.25, category: 0.2, text: 0.1 },
  autoAttach: 0.8,
  ambiguous: 0.55,
};

/**
 * dedup-2 (ADR 0030): suma la similitud de fotos (hash perceptual) que el Blueprint §8.4 prevé como `sim_media`
 * y reparte su peso entre los demás términos. Sin fotos en alguno de los lados el término es neutro (0,5).
 */
export const DEDUP_RULES_V2: DedupRuleSet = {
  version: "dedup-2",
  weights: { distance: 0.4, time: 0.22, category: 0.18, text: 0.1, media: 0.1 },
  autoAttach: 0.8,
  ambiguous: 0.55,
};

/** Reglas vigentes. */
export const DEDUP_RULES = DEDUP_RULES_V2;

export interface DedupCandidateEvent {
  id: string;
  categoryCode: string;
  point: GeoPoint;
  lastActivityAt: Date;
  keywords?: string[];
  /** Hash perceptual (64 bits en hex) de las fotos ya asociadas al evento. */
  mediaHashes?: string[];
}

export interface DedupInput {
  categoryCode: string;
  point: GeoPoint;
  observedAt: Date;
  keywords?: string[];
  dedupRadiusM: number;
  dedupWindowMinutes: number;
  /** Códigos compatibles para fusionar (además de la misma categoría). */
  compatibleWith: readonly string[];
  mediaHashes?: string[];
}

export type DedupDecision =
  | { kind: "ATTACH"; eventId: string; score: number }
  | { kind: "AMBIGUOUS"; candidates: Array<{ eventId: string; score: number }> }
  | { kind: "NEW" };

export function categoryCompatibility(a: string, b: string, compatibleWith: readonly string[]): number {
  if (a === b) return 1;
  if (compatibleWith.includes(b)) return 0.8;
  const rootA = a.split(".")[0];
  const rootB = b.split(".")[0];
  return rootA === rootB ? 0.5 : 0;
}

/** Similitud de Jaccard entre conjuntos de palabras clave (determinista, sin IA). */
export function keywordSimilarity(a: readonly string[] = [], b: readonly string[] = []): number {
  if (a.length === 0 || b.length === 0) return 0.5; // neutro: sin texto no se penaliza ni se premia
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/** Distancia de Hamming entre dos hashes hex de 64 bits (16 caracteres). */
export function hammingHex(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < 16; i += 4) {
    let x = parseInt(a.slice(i, i + 4), 16) ^ parseInt(b.slice(i, i + 4), 16);
    while (x) { d += x & 1; x >>>= 1; }
  }
  return d;
}

/**
 * Similitud de fotos: el par más parecido decide. ≤ 6 bits = misma escena (1); ≥ 24 bits = nada que ver (0);
 * lineal entre medias. Sin fotos en algún lado: neutro (0,5), como el texto.
 */
export function mediaSimilarity(a: readonly string[] = [], b: readonly string[] = []): number {
  if (a.length === 0 || b.length === 0) return 0.5;
  let best = 64;
  for (const x of a) for (const y of b) best = Math.min(best, hammingHex(x, y));
  if (best <= 6) return 1;
  if (best >= 24) return 0;
  return Math.round((1 - (best - 6) / 18) * 1000) / 1000;
}

export function matchScore(input: DedupInput, event: DedupCandidateEvent, rules: DedupRuleSet = DEDUP_RULES): number {
  const compat = categoryCompatibility(input.categoryCode, event.categoryCode, input.compatibleWith);
  if (compat === 0) return 0;
  const d = distanceMeters(input.point, event.point);
  if (d > input.dedupRadiusM) return 0;
  const dtMin = Math.abs(input.observedAt.getTime() - event.lastActivityAt.getTime()) / 60000;
  if (dtMin > input.dedupWindowMinutes) return 0;
  const fDist = Math.exp(-2 * (d / input.dedupRadiusM) ** 2);
  const fTime = Math.exp(-2 * (dtMin / input.dedupWindowMinutes) ** 2);
  const w = rules.weights;
  const score = w.distance * fDist + w.time * fTime + w.category * compat + w.text * keywordSimilarity(input.keywords, event.keywords)
    + (w.media ?? 0) * mediaSimilarity(input.mediaHashes, event.mediaHashes);
  return Math.round(score * 1000) / 1000;
}

export function decideDedup(
  input: DedupInput,
  candidates: readonly DedupCandidateEvent[],
  rules: DedupRuleSet = DEDUP_RULES,
): DedupDecision {
  const scored = candidates
    .map((e) => ({ eventId: e.id, score: matchScore(input, e, rules) }))
    .filter((s) => s.score >= rules.ambiguous)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return { kind: "NEW" };
  const [best, second] = scored;
  // Adjuntar solo si el mejor es claro y no hay otro candidato casi igual de bueno.
  if (best!.score >= rules.autoAttach && (!second || best!.score - second.score >= 0.1)) {
    return { kind: "ATTACH", eventId: best!.eventId, score: best!.score };
  }
  return { kind: "AMBIGUOUS", candidates: scored.slice(0, 5) };
}

/** Palabras clave normalizadas (minúsculas, sin tildes, sin palabras vacías). */
const STOPWORDS = new Set(
  "el la los las un una unos unas de del y o en a al con por para que se es hay muy mas the a an of and or in on at to is are there".split(" "),
);
export function extractKeywords(text: string | undefined | null): string[] {
  if (!text) return [];
  return [
    ...new Set(
      text
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .split(/[^a-z0-9ñ]+/)
        .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
    ),
  ].slice(0, 30);
}

/** Mínimo de palabras para que dos textos iguales se consideren "copiados" y no una coincidencia natural. */
export const TEXT_FINGERPRINT_MIN_WORDS = 4;

/**
 * Huella de un texto para detectar copias entre reportes (ADR 0074, Blueprint §10.2 "patrones idénticos"): sin
 * mayúsculas, tildes, signos ni espacios extra. Los textos cortos ("choque", "hay humo") no llevan huella: es normal
 * que varias personas reales escriban lo mismo. Devuelve el texto normalizado; quien lo guarde lo resume con un hash.
 */
export function textFingerprint(text: string | undefined | null): string | null {
  if (!text) return null;
  const words = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9ñ]+/)
    .filter(Boolean);
  return words.length >= TEXT_FINGERPRINT_MIN_WORDS ? words.join(" ") : null;
}
