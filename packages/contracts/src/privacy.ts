/**
 * Exportación de datos personales (Blueprint §13.2, ADR 0038): todo lo que Dizaster guarda de una persona, por
 * módulo, en JSON legible por máquina. No incluye secretos (tokens), datos de otras personas (quién la denunció)
 * ni heurísticas antiabuso (puntajes de presencia o reputación).
 */
export const DATA_EXPORT_FORMAT = "dizaster-export-1";

export interface DataExport {
  format: typeof DATA_EXPORT_FORMAT;
  generatedAt: string;
  sections: Record<"identity" | "social" | "reports" | "alerts" | "moderation" | "media", Record<string, unknown[]>>;
}
