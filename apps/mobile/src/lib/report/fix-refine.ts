import type { LocationLike } from "./presence";

/**
 * Seguimiento breve del GPS mientras se redacta el reporte (ADR 0192, §8.2). NO AI REQUIRED.
 * - Afina la precisión: una lectura nueva reemplaza al fix solo si es más precisa y el fix aún no llega a la meta.
 * - Da trayectoria a la regla de "movimiento imposible" del servidor (hasta 10 lecturas recientes).
 * Solo en primer plano y solo mientras la pantalla está abierta, con tope de tiempo (batería).
 */
export const FIX_TARGET_ACCURACY_M = 50;
export const WATCH_INTERVAL_MS = 5_000;
export const WATCH_MAX_MS = 2 * 60_000;
export const RECENT_MAX = 10;

const acc = (l: LocationLike) => l.coords.accuracy ?? Number.POSITIVE_INFINITY;

export function betterFix(current: LocationLike, next: LocationLike, targetM = FIX_TARGET_ACCURACY_M): boolean {
  return acc(current) > targetM && acc(next) < acc(current) && next.timestamp >= current.timestamp;
}

/** Añade una lectura a la trayectoria: sin repetidos por hora y con las más recientes al final. */
export function pushRecent<T extends LocationLike>(list: T[], next: T, max = RECENT_MAX): T[] {
  if (list.some((l) => l.timestamp === next.timestamp)) return list;
  return [...list, next].sort((a, b) => a.timestamp - b.timestamp).slice(-max);
}

/** Si la persona no movió el pin, sigue al fix afinado; si lo movió, se respeta. */
export const pinFollowsFix = (pin: { lat: number; lng: number }, oldFix: LocationLike) =>
  pin.lat === oldFix.coords.latitude && pin.lng === oldFix.coords.longitude;
