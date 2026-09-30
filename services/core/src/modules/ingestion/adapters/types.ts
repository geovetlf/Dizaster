import type { NormalizedItem } from "../index.js";

/**
 * Un adapter por FORMATO de fuente. Solo transforma: no hace red ni toca la base de datos,
 * así se prueba con archivos de ejemplo y se reutiliza para todas las fuentes con ese formato.
 */
export interface FeedAdapter {
  readonly adapterType: string;
  parse(body: string, config: Record<string, unknown>): NormalizedItem[];
  /** ¿Justifica el carril URGENT? (p. ej. sismo ≥ 4,5 o alerta naranja/roja). */
  isUrgent(item: NormalizedItem, config: Record<string, unknown>): boolean;
  /** Ids externos que la fuente retiró en este documento (p. ej. CAP `Cancel`). No son desmentidos. */
  withdrawals?(body: string, config: Record<string, unknown>): string[];
}

/** Coordenada utilizable (ADR 0242): finita y dentro de rango. Un punto malo se salta, no tumba la corrida. */
export const validLatLng = (lat: unknown, lng: unknown): boolean =>
  typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

export const num = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/**
 * Mapeo "tipo de la fuente → categoría de Dizaster" (§9.4, ADR 0122). Es dato del registro (`config.categoryMap`),
 * validado al cargar el registro; el del código solo es el valor por defecto de cada formato.
 */
export function categoryMap(config: Record<string, unknown>, defaults: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  const m = config["categoryMap"];
  return m && typeof m === "object" && !Array.isArray(m) ? (m as Record<string, string>) : defaults;
}
