/**
 * Exportación de datos personales (Blueprint §13.2, ADR 0038): todo lo que Dizaster guarda de una persona, por
 * módulo, en JSON legible por máquina. No incluye secretos (tokens), datos de otras personas (quién la denunció)
 * ni heurísticas antiabuso (puntajes de presencia o reputación).
 */
export const DATA_EXPORT_FORMAT = "dizaster-export-1";

/**
 * Filas por lista en una exportación (ADR 0295). Cada módulo pide una más para saber si hay más; las listas que
 * llegan al tope se nombran en `truncated` ("seccion.lista"), así la exportación nunca parece completa sin serlo.
 */
export const DATA_EXPORT_ROW_LIMIT = 10_000;

export interface DataExport {
  format: typeof DATA_EXPORT_FORMAT;
  generatedAt: string;
  sections: Record<"identity" | "social" | "reports" | "alerts" | "moderation" | "media", Record<string, unknown[]>>;
  /** Listas recortadas al tope (`DATA_EXPORT_ROW_LIMIT`), como "social.reactions". Vacía si todo está completo. */
  truncated: string[];
}

/**
 * Recorta cada lista a `DATA_EXPORT_ROW_LIMIT` y nombra las recortadas (ADR 0295). Los módulos piden una fila de más
 * justo para que esto sepa si había más. NO AI REQUIRED.
 */
export function capExportSections<S extends Record<string, Record<string, unknown[]>>>(sections: S, limit = DATA_EXPORT_ROW_LIMIT): { sections: S; truncated: string[] } {
  const truncated: string[] = [];
  const out = {} as Record<string, Record<string, unknown[]>>;
  for (const [section, lists] of Object.entries(sections)) {
    out[section] = {};
    for (const [name, rows] of Object.entries(lists)) {
      if (rows.length > limit) truncated.push(`${section}.${name}`);
      out[section]![name] = rows.length > limit ? rows.slice(0, limit) : rows;
    }
  }
  return { sections: out as S, truncated };
}
