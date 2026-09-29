import type { EventMapResponse } from "@dizaster/contracts";

/**
 * Consultas del mapa alineadas a teselas (ADR 0078, Blueprint §11.4): la app pide las teselas z/x/y que
 * cubren su vista en lugar de un bbox arbitrario, así la misma zona produce las mismas URLs para todos y la CDN
 * sirve una sola consulta a muchos usuarios. Esquema XYZ (Web Mercator), el de MapLibre y OSM.
 */
export interface Tile { z: number; x: number; y: number }

export const MAX_TILE_ZOOM = 20;
/** Una vista normal de teléfono cubre 2×3 teselas; con más, se baja un nivel de zoom. */
export const MAX_TILES_PER_VIEW = 12;
const MAX_LAT = 85.0511287798;

const lngToX = (lng: number, n: number) => Math.min(n - 1, Math.max(0, Math.floor(((lng + 180) / 360) * n)));
function latToY(lat: number, n: number): number {
  const r = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180;
  return Math.min(n - 1, Math.max(0, Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)));
}

/** Límites [oeste, sur, este, norte] de una tesela. */
export function tileBounds({ z, x, y }: Tile): [number, number, number, number] {
  const n = 2 ** z;
  const lat = (yy: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * yy) / n))) * 180) / Math.PI;
  return [(x / n) * 360 - 180, lat(y + 1), ((x + 1) / n) * 360 - 180, lat(y)];
}

export function isValidTile({ z, x, y }: Tile): boolean {
  const n = 2 ** z;
  return Number.isInteger(z) && Number.isInteger(x) && Number.isInteger(y) && z >= 0 && z <= MAX_TILE_ZOOM && x >= 0 && x < n && y >= 0 && y < n;
}

/** Teselas que cubren una vista. Si son demasiadas, baja el zoom hasta que entren (nunca más de `maxTiles`). */
export function tilesForView(bbox: readonly [number, number, number, number], zoom: number, maxTiles = MAX_TILES_PER_VIEW): Tile[] {
  const [w, s, e, nth] = bbox;
  for (let z = Math.max(0, Math.min(MAX_TILE_ZOOM, Math.round(zoom))); z >= 0; z--) {
    const n = 2 ** z;
    // Cruce del antimeridiano (oeste > este): dos tramos de columnas.
    const xs = w <= e ? range(lngToX(w, n), lngToX(e, n)) : [...range(lngToX(w, n), n - 1), ...range(0, lngToX(e, n))];
    const ys = range(latToY(nth, n), latToY(s, n));
    if (xs.length * ys.length <= maxTiles || z === 0) return xs.flatMap((x) => ys.map((y) => ({ z, x, y })));
  }
  return [{ z: 0, x: 0, y: 0 }];
}

function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

/**
 * Une las respuestas de varias teselas: un evento sobre el borde de dos teselas llega dos veces (se queda uno) y un
 * cluster H3 partido por un borde se suma en uno solo.
 */
export function mergeMapTiles(parts: readonly EventMapResponse[]): EventMapResponse {
  const mode = parts.some((p) => p.mode === "clusters") ? "clusters" : "points";
  const events = new Map<string, EventMapResponse["events"][number]>();
  const clusters = new Map<string, EventMapResponse["clusters"][number]>();
  for (const p of parts) {
    for (const e of p.events) events.set(e.id, e);
    for (const c of p.clusters) {
      const prev = clusters.get(c.h3);
      clusters.set(c.h3, prev ? { ...prev, count: prev.count + c.count, maxSeverity: Math.max(prev.maxSeverity, c.maxSeverity) } : c);
    }
  }
  return { mode, events: mode === "points" ? [...events.values()] : [], clusters: mode === "clusters" ? [...clusters.values()] : [] };
}
