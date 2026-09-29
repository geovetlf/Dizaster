import { z } from "zod";

/** Nivel positivo de corroboración. Solo sube. */
export const VerificationLevel = z.enum([
  "UNVERIFIED",
  "COMMUNITY_CORROBORATED",
  "EXTERNALLY_CORROBORATED",
  "OFFICIALLY_CONFIRMED",
]);
export type VerificationLevel = z.infer<typeof VerificationLevel>;

export const VERIFICATION_LEVEL_RANK: Record<VerificationLevel, number> = {
  UNVERIFIED: 0,
  COMMUNITY_CORROBORATED: 1,
  EXTERNALLY_CORROBORATED: 2,
  OFFICIALLY_CONFIRMED: 3,
};

/**
 * Estados negativos (aprobados: DISPUTED y FALSE). Son una dimensión separada del nivel:
 * un evento puede haber sido corroborado y luego quedar en disputa o declararse falso.
 */
export const NegativeState = z.enum(["NONE", "DISPUTED", "FALSE"]);
export type NegativeState = z.infer<typeof NegativeState>;

/** Estado público que se muestra: FALSE > DISPUTED > nivel. */
export const PublicVerificationState = z.enum([...VerificationLevel.options, "DISPUTED", "FALSE"]);
export type PublicVerificationState = z.infer<typeof PublicVerificationState>;

export function publicVerificationState(level: VerificationLevel, negative: NegativeState): PublicVerificationState {
  if (negative === "FALSE") return "FALSE";
  if (negative === "DISPUTED") return "DISPUTED";
  return level;
}

/**
 * Causa de una transición. La IA NO figura: sus sugerencias viven aparte y no cambian estados.
 * OFFICIALLY_CONFIRMED solo acepta OFFICIAL_SOURCE (garantizado también en la base de datos).
 */
export const TransitionCause = z.enum(["RULE", "OFFICIAL_SOURCE", "MODERATOR"]);
export type TransitionCause = z.infer<typeof TransitionCause>;

export const TrustTier = z.enum(["CITIZEN", "EXTERNAL", "OFFICIAL"]);
export type TrustTier = z.infer<typeof TrustTier>;

export const VerificationExplanation = z.object({
  code: z.string(),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
});
export type VerificationExplanation = z.infer<typeof VerificationExplanation>;

export const VerificationView = z.object({
  eventId: z.uuid(),
  level: VerificationLevel,
  negativeState: NegativeState,
  publicState: PublicVerificationState,
  ruleSetVersion: z.string(),
  evaluatedAt: z.string(),
  explanation: z.array(VerificationExplanation),
  evidenceSummary: z.object({ citizen: z.number(), external: z.number(), official: z.number() }),
});
export type VerificationView = z.infer<typeof VerificationView>;
