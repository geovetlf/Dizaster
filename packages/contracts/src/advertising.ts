/**
 * Reglas de exclusión de publicidad (Blueprint §5.16, C-09, D-14; ADR 0126). En V1 NO hay anuncios
 * (`ADS_ENABLED_V1 = false`): este módulo deja escritas y probadas las reglas fijas para que cualquier
 * implementación futura (servidor o app) tenga que pasar por aquí. Lógica pura, compartida. NO AI REQUIRED.
 */

/** D-14: sin publicidad en V1. Cambiarlo exige una decisión del propietario y un ADR. */
export const ADS_ENABLED_V1 = false;

/** Pantallas o superficies donde podría ir un espacio publicitario. */
export type AdSurface =
  | "FEED" | "EVENT" | "MAP" | "SEARCH" | "PROFILE" | "BUSINESS"
  | "ALERT" | "EMERGENCY" | "REPORT" | "COMPOSE" | "MODERATION" | "SETTINGS";

/** Superficies donde nunca hay anuncios, pase lo que pase (alertas, emergencia, reportar, moderación...). */
export const AD_FORBIDDEN_SURFACES: readonly AdSurface[] = ["ALERT", "EMERGENCY", "REPORT", "COMPOSE", "MODERATION", "SETTINGS"];

/** Severidad desde la que un evento no lleva anuncios cerca (ni en su ficha ni junto a sus posts). */
export const AD_MAX_EVENT_SEVERITY = 3;

/** Segmentación geográfica más fina admitida: región (nivel 1). Nunca ciudad, zona, H3 ni ubicación precisa. */
export type AdTargetingPrecision = "NONE" | "COUNTRY" | "REGION" | "CITY" | "ZONE" | "PRECISE";
const TARGETING_ALLOWED: ReadonlySet<AdTargetingPrecision> = new Set(["NONE", "COUNTRY", "REGION"]);

export interface AdPlacementContext {
  surface: AdSurface;
  /** Evento junto al que aparecería (ficha del evento o post vinculado). */
  event?: { severity: number; status: string; sensitivity: "NORMAL" | "SENSITIVE" | "HIGHLY_SENSITIVE" } | null;
  targeting: AdTargetingPrecision;
  /** Marca visible "Patrocinado": obligatoria. */
  labeled: boolean;
  /** Forzar la evaluación de reglas aunque V1 no tenga anuncios (pruebas, simulación). */
  evaluateEvenIfDisabled?: boolean;
}

export type AdDenial =
  | "ADS_DISABLED_V1" | "FORBIDDEN_SURFACE" | "HIGH_SEVERITY_EVENT" | "SENSITIVE_EVENT" | "ACTIVE_EMERGENCY_EVENT"
  | "PRECISE_TARGETING" | "NOT_LABELED";

/**
 * ¿Puede ir un anuncio aquí? Devuelve todos los motivos de rechazo (vacío = permitido). Reglas fijas:
 * nunca en alertas, emergencia ni reportes; nunca junto a eventos de severidad alta, sensibles o activos de
 * categorías sensibles; nunca con segmentación más fina que región; siempre marcado como patrocinado.
 */
export function adPlacementDenials(ctx: AdPlacementContext): AdDenial[] {
  const out: AdDenial[] = [];
  if (!ADS_ENABLED_V1 && !ctx.evaluateEvenIfDisabled) out.push("ADS_DISABLED_V1");
  if (AD_FORBIDDEN_SURFACES.includes(ctx.surface)) out.push("FORBIDDEN_SURFACE");
  const e = ctx.event;
  if (e) {
    if (e.severity > AD_MAX_EVENT_SEVERITY) out.push("HIGH_SEVERITY_EVENT");
    if (e.sensitivity !== "NORMAL") out.push("SENSITIVE_EVENT");
    // Un evento en curso en el mapa es una emergencia para alguien: el mapa no lleva anuncios encima de él.
    if (ctx.surface === "MAP" && (e.status === "ACTIVE" || e.status === "MONITORING")) out.push("ACTIVE_EMERGENCY_EVENT");
  }
  if (!TARGETING_ALLOWED.has(ctx.targeting)) out.push("PRECISE_TARGETING");
  if (!ctx.labeled) out.push("NOT_LABELED");
  return out;
}

export const adPlacementAllowed = (ctx: AdPlacementContext): boolean => adPlacementDenials(ctx).length === 0;
