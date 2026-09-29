import type { ContextualLocation } from "@dizaster/contracts";

/**
 * Lugar que se puede seguir desde un evento: el distrito si se publica; si no, la región. La "ciudad" de países
 * sin polígonos de ciudad es una localidad puntual y no se puede seguir como área.
 */
export function followablePlace(place: ContextualLocation | null): { id: string; name: string } | null {
  if (!place) return null;
  const area = place.district ?? place.region;
  return area ? { id: area.id, name: area.name } : null;
}
