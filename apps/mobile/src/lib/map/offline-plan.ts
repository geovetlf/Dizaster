/**
 * Plan de descarga del mapa de una zona guardada (ADR 0041). Puro: sin módulos nativos, se prueba en Node.
 * Límite de teselas para que una zona no ocupe cientos de MB en el teléfono ni cueste egreso al servidor.
 */
export type Bounds = [west: number, south: number, east: number, north: number];

export const OFFLINE_MIN_ZOOM = 8;
export const OFFLINE_MAX_ZOOM = 15;
/** ~3000 teselas vectoriales ≈ 60–120 MB según densidad urbana. */
export const OFFLINE_MAX_TILES = 3000;
/** Tamaño medio estimado de una tesela vectorial OSM (para avisar antes de descargar). */
export const AVG_TILE_BYTES = 30_000;

const KM_PER_DEG_LAT = 110.574;

/** Rectángulo que cubre la zona (centro + radio), con margen de 10 %. */
export function zoneBounds(center: { lat: number; lng: number }, radiusKm: number): Bounds {
  const r = radiusKm * 1.1;
  const dLat = r / KM_PER_DEG_LAT;
  const cos = Math.max(0.01, Math.cos((center.lat * Math.PI) / 180));
  const dLng = r / (111.32 * cos);
  const clampLat = (v: number) => Math.max(-85.05, Math.min(85.05, v));
  return [center.lng - dLng, clampLat(center.lat - dLat), center.lng + dLng, clampLat(center.lat + dLat)];
}

function tileX(lng: number, z: number) {
  return Math.floor(((lng + 180) / 360) * 2 ** z);
}
function tileY(lat: number, z: number) {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

/** Número de teselas del rectángulo entre dos zooms (esquema XYZ). */
export function tileCount(b: Bounds, minZoom: number, maxZoom: number): number {
  let n = 0;
  for (let z = minZoom; z <= maxZoom; z++) {
    const xs = tileX(b[2], z) - tileX(b[0], z) + 1;
    const ys = tileY(b[1], z) - tileY(b[3], z) + 1;
    n += xs * ys;
  }
  return n;
}

export interface OfflinePlan { bounds: Bounds; minZoom: number; maxZoom: number; tiles: number; estimatedMb: number }

/** Baja el zoom máximo hasta caber en el límite: una zona de 50 km se descarga con menos detalle que una de 2 km. */
export function planZonePack(center: { lat: number; lng: number }, radiusKm: number): OfflinePlan {
  const bounds = zoneBounds(center, radiusKm);
  let maxZoom = OFFLINE_MAX_ZOOM;
  let tiles = tileCount(bounds, OFFLINE_MIN_ZOOM, maxZoom);
  while (tiles > OFFLINE_MAX_TILES && maxZoom > OFFLINE_MIN_ZOOM + 2) {
    maxZoom--;
    tiles = tileCount(bounds, OFFLINE_MIN_ZOOM, maxZoom);
  }
  return { bounds, minZoom: OFFLINE_MIN_ZOOM, maxZoom, tiles, estimatedMb: Math.max(1, Math.round((tiles * AVG_TILE_BYTES) / 1e6)) };
}
