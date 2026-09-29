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
}

export const num = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
