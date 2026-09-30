import type { ModeratorEvidenceView, NearbyEvent } from "@dizaster/contracts";

/** Posibles duplicados para fusionar en este evento: los cercanos de la misma categoría, sin él mismo. */
export function duplicateCandidates(nearby: NearbyEvent[], eventId: string, max = 10): NearbyEvent[] {
  return nearby.filter((e) => e.id !== eventId).slice(0, max);
}

/** Dividir exige elegir algo y dejar al menos una evidencia en el evento original (el servidor lo comprueba igual). */
export function canSplit(selected: ReadonlySet<string>, evidence: ModeratorEvidenceView[]): boolean {
  const ids = new Set(evidence.map((e) => e.id));
  const picked = [...selected].filter((id) => ids.has(id)).length;
  return picked > 0 && picked < ids.size;
}

export function toggle(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * ¿Se puede marcar el evento con este estado negativo? (ADR 0096). FALSE exige citar evidencia (las seleccionadas) y
 * nunca aplica a un evento confirmado oficialmente: eso solo lo desmiente una fuente oficial. El servidor lo comprueba igual.
 * NO AI REQUIRED.
 */
export function canSetNegative(
  to: "NONE" | "DISPUTED" | "FALSE",
  current: { negativeState: string; level: string },
  selectedEvidence: number,
): boolean {
  if (current.negativeState === to) return false;
  if (to === "FALSE") return selectedEvidence > 0 && current.level !== "OFFICIALLY_CONFIRMED";
  return true;
}

/** Niveles a los que se puede subir la sensibilidad desde el actual (ADR 0179): nunca se baja. */
export function raisableSensitivities(current: "NORMAL" | "SENSITIVE" | "HIGHLY_SENSITIVE"): ("SENSITIVE" | "HIGHLY_SENSITIVE")[] {
  const order = ["NORMAL", "SENSITIVE", "HIGHLY_SENSITIVE"] as const;
  return order.slice(order.indexOf(current) + 1) as ("SENSITIVE" | "HIGHLY_SENSITIVE")[];
}
