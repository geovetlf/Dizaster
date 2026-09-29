import type { AffectedAreaView } from "@dizaster/contracts";

/**
 * Recuadro [oeste, sur, este, norte] que contiene el área oficial y el punto del evento (ADR 0144), con un margen
 * relativo para que el contorno no toque el borde. null si el área no trae coordenadas válidas. NO AI REQUIRED.
 */
export function areaBounds(area: AffectedAreaView, point: { lat: number; lng: number }, margin = 0.1): [number, number, number, number] | null {
  let w = point.lng, s = point.lat, e = point.lng, n = point.lat, any = false;
  for (const polygon of area.coordinates) for (const ring of polygon) for (const c of ring) {
    const [lng, lat] = c;
    if (typeof lng !== "number" || typeof lat !== "number" || !Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    any = true;
    w = Math.min(w, lng); e = Math.max(e, lng); s = Math.min(s, lat); n = Math.max(n, lat);
  }
  if (!any) return null;
  const dx = Math.max((e - w) * margin, 0.005), dy = Math.max((n - s) * margin, 0.005);
  return [Math.max(-180, w - dx), Math.max(-85, s - dy), Math.min(180, e + dx), Math.min(85, n + dy)];
}
