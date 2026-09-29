/** Hasta cuántas fusiones encadenadas se sigue (A→B→C...). Una cadena más larga indica un dato roto. */
export const MAX_MERGE_HOPS = 5;

/**
 * Evento fusionado (ADR 0093): a dónde redirigir la pantalla, o null si se muestra tal cual.
 * NO AI REQUIRED.
 */
export function mergedTarget(e: { id: string; mergedIntoId?: string | null }, hops: number): string | null {
  if (!e.mergedIntoId || e.mergedIntoId === e.id) return null;
  return hops < MAX_MERGE_HOPS ? e.mergedIntoId : null;
}
