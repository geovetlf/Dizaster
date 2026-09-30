import { cellToLatLng, gridDisk, latLngToCell, getHexagonEdgeLengthAvg, UNITS } from "h3-js";
import type { GeoPoint, Sensitivity } from "@dizaster/contracts";

/** Resoluciones H3 con significado de negocio (ver Blueprint §11.6). */
export const H3_RES = {
  REGION: 5,
  ZONE: 7,
  SENSITIVE: 8,
  DEDUP: 9,
  PUBLIC_POINT: 10,
} as const;

export function h3(point: GeoPoint, res: number): string {
  return latLngToCell(point.lat, point.lng, res);
}

export function h3Center(cell: string): GeoPoint {
  const [lat, lng] = cellToLatLng(cell);
  return { lat, lng };
}

export function kRing(cell: string, k: number): string[] {
  return gridDisk(cell, k);
}

/** Anillo k mínimo que cubre un radio en metros a una resolución dada. */
export function kForRadius(radiusM: number, res: number): number {
  const edgeM = getHexagonEdgeLengthAvg(res, UNITS.m);
  return Math.max(1, Math.ceil(radiusM / (edgeM * 1.5)));
}

const SENSITIVITY_RES: Record<Sensitivity, number> = {
  NORMAL: H3_RES.PUBLIC_POINT,
  SENSITIVE: H3_RES.SENSITIVE,
  HIGHLY_SENSITIVE: H3_RES.ZONE,
};

/**
 * Generalización de privacidad: la ubicación pública es el centro de una celda H3 cuyo tamaño
 * depende de la sensibilidad. Nunca devuelve la coordenada original.
 */
export function generalize(point: GeoPoint, sensitivity: Sensitivity): { point: GeoPoint; cell: string; res: number } {
  const res = SENSITIVITY_RES[sensitivity];
  const cell = h3(point, res);
  return { point: h3Center(cell), cell, res };
}

/**
 * Distancia máxima entre un punto y su ubicación pública (ADR 0230): el radio de la celda H3 de su sensibilidad
 * (en un hexágono, centro→vértice = arista). Sirve para buscar sobre la ubicación pública sin perder candidatos.
 */
export function generalizationMarginM(sensitivity: Sensitivity): number {
  return Math.ceil(getHexagonEdgeLengthAvg(SENSITIVITY_RES[sensitivity], UNITS.m) * 1.2);
}

/** Resolución de agregación para el mapa según el zoom (clusters en zoom bajo, puntos en zoom alto). */
export function clusterResolutionForZoom(zoom: number): number | null {
  if (zoom >= 13) return null; // puntos individuales
  if (zoom >= 10) return 7;
  if (zoom >= 7) return 5;
  if (zoom >= 4) return 3;
  return 2;
}
