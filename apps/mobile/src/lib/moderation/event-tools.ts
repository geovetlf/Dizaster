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
