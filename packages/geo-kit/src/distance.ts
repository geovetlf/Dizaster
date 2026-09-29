import type { GeoPoint } from "@dizaster/contracts";

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (d: number) => (d * Math.PI) / 180;

/** Distancia de gran círculo (haversine) en metros. Suficiente para radios de presencia y deduplicación. */
export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Mediana ponderada por coordenada. Robusta frente a un pin atípico (a diferencia de la media).
 * Se usa para la ubicación agregada de un EVENT a partir de los pines de sus reportes.
 */
export function weightedMedianPoint(points: ReadonlyArray<{ point: GeoPoint; weight: number }>): GeoPoint {
  if (points.length === 0) throw new Error("weightedMedianPoint: lista vacía");
  const median = (values: Array<{ v: number; w: number }>) => {
    const sorted = [...values].sort((x, y) => x.v - y.v);
    const total = sorted.reduce((s, x) => s + x.w, 0);
    let acc = 0;
    for (const x of sorted) {
      acc += x.w;
      if (acc >= total / 2) return x.v;
    }
    return sorted[sorted.length - 1]!.v;
  };
  const safe = points.map((p) => ({ ...p, weight: p.weight > 0 ? p.weight : 1e-6 }));
  return {
    lat: median(safe.map((p) => ({ v: p.point.lat, w: p.weight }))),
    lng: median(safe.map((p) => ({ v: p.point.lng, w: p.weight }))),
  };
}
