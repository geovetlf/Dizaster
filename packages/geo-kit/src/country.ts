import type { GeoPoint } from "@dizaster/contracts";
import { distanceMeters } from "./distance.js";

type Ring = number[][];
type PolygonCoords = Ring[];
export interface CountryFeature {
  properties: { iso2: string; iso3?: string; name?: string };
  geometry: { type: "Polygon"; coordinates: PolygonCoords } | { type: "MultiPolygon"; coordinates: PolygonCoords[] };
}

interface IndexedCountry {
  iso2: string;
  polygons: PolygonCoords[];
  bbox: [number, number, number, number];
}

function pointInRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0]!, yi = ring[i]![1]!;
    const xj = ring[j]![0]!, yj = ring[j]![1]!;
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lng: number, lat: number, poly: PolygonCoords): boolean {
  if (!poly[0] || !pointInRing(lng, lat, poly[0])) return false;
  for (let h = 1; h < poly.length; h++) if (pointInRing(lng, lat, poly[h]!)) return false;
  return true;
}

/**
 * Localizador de país 100 % local (sin red, sin API): funciona en el dispositivo para mostrar
 * números de emergencia offline y en el servidor para asignar país a un evento.
 */
export class CountryLocator {
  private readonly countries: IndexedCountry[];

  constructor(features: readonly CountryFeature[]) {
    this.countries = features.map((f) => {
      const polygons = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
      let w = 180, s = 90, e = -180, n = -90;
      for (const poly of polygons)
        for (const [x, y] of poly[0] ?? []) {
          if (x! < w) w = x!;
          if (x! > e) e = x!;
          if (y! < s) s = y!;
          if (y! > n) n = y!;
        }
      return { iso2: f.properties.iso2, polygons, bbox: [w, s, e, n] };
    });
  }

  /**
   * País que contiene el punto. Si cae fuera de todo polígono (costa, datos simplificados),
   * devuelve el país más cercano dentro de `maxDistanceM`, útil para playas y puertos.
   */
  locate(point: GeoPoint, maxDistanceM = 25_000): string | null {
    const { lat, lng } = point;
    for (const c of this.countries) {
      const [w, s, e, n] = c.bbox;
      if (lng < w || lng > e || lat < s || lat > n) continue;
      if (c.polygons.some((p) => pointInPolygon(lng, lat, p))) return c.iso2;
    }
    const margin = maxDistanceM / 111_000 + 0.1;
    let best: { iso2: string; d: number } | null = null;
    for (const c of this.countries) {
      const [w, s, e, n] = c.bbox;
      if (lng < w - margin || lng > e + margin || lat < s - margin || lat > n + margin) continue;
      for (const poly of c.polygons)
        for (const [x, y] of poly[0] ?? []) {
          const d = distanceMeters(point, { lat: y!, lng: x! });
          if (d <= maxDistanceM && (!best || d < best.d)) best = { iso2: c.iso2, d };
        }
    }
    return best?.iso2 ?? null;
  }
}
