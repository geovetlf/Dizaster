import type { PublicVerificationState } from "@dizaster/contracts";

/**
 * Cómo se ve un evento en el mapa según su estado público (Blueprint §11.4, ADR 0057): el relleno es la categoría y
 * el borde, la verificación. Lo confirmado resalta; lo sin verificar y lo disputado se ven más tenues.
 */
export const VERIFICATION_STROKE: Record<PublicVerificationState, { color: string; width: number; opacity: number }> = {
  UNVERIFIED: { color: "#8a94a6", width: 1.5, opacity: 0.75 },
  COMMUNITY_CORROBORATED: { color: "#2f80ed", width: 2.5, opacity: 1 },
  EXTERNALLY_CORROBORATED: { color: "#9b51e0", width: 2.5, opacity: 1 },
  OFFICIALLY_CONFIRMED: { color: "#27ae60", width: 3.5, opacity: 1 },
  DISPUTED: { color: "#f2994a", width: 2.5, opacity: 0.6 },
  FALSE: { color: "#eb5757", width: 1, opacity: 0.4 },
};

export interface MapFilter {
  /** Categoría raíz ("fire") o null para todas. */
  category: string | null;
  verifiedOnly: boolean;
}

/** Parámetros extra de /v1/events para el filtro (vacío si no hay filtro: la URL sin filtro se cachea mejor). */
export function mapFilterQuery(f: MapFilter): string {
  return `${f.category ? `&categories=${encodeURIComponent(f.category)}` : ""}${f.verifiedOnly ? "&verified=1" : ""}`;
}
