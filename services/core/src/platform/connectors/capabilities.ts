/**
 * Catálogo de capacidades del AI CORE (ADR 0110). Lista cerrada: añadir una exige un ADR. Ninguna es necesaria para
 * que DIZASTER funcione: cada una declara la regla determinista que se usa sin IA (o cuando la IA falla, está apagada
 * o sin presupuesto). Ninguna produce OFFICIALLY_CONFIRMED ni FALSE: todas dejan sugerencias.
 */
export const AI_CAPABILITIES = [
  "ANALYZE_REPORT",
  "CLASSIFY_INCIDENT",
  "EXTRACT_INCIDENT_DATA",
  "ANALYZE_IMAGE",
  "ANALYZE_VIDEO",
  "DETECT_DUPLICATE",
  "GENERATE_EMBEDDING",
  "TRANSLATE_TEXT",
  "SUMMARIZE_INCIDENT",
  "MODERATE_CONTENT",
  "SAFETY_CLASSIFICATION",
  "MULTIMODAL_REASONING",
  "OPERATIONAL_SUMMARY",
] as const;
export type AiCapability = (typeof AI_CAPABILITIES)[number];

/** Nombres anteriores (ADR 0110) → actuales (ADR 0217): el registro de uso y la configuración viejos se siguen leyendo. */
export const AI_CAPABILITY_ALIASES: Readonly<Record<string, AiCapability>> = {
  DETECT_SIMILARITY: "DETECT_DUPLICATE",
  SUMMARIZE: "SUMMARIZE_INCIDENT",
  EXTRACT_INFORMATION: "EXTRACT_INCIDENT_DATA",
  MODERATE: "MODERATE_CONTENT",
  TRANSLATE: "TRANSLATE_TEXT",
};

/** Nombre actual de una capacidad (acepta los anteriores); null si no existe. */
export function canonicalCapability(name: string): AiCapability | null {
  const n = name.trim().toUpperCase();
  return (AI_CAPABILITIES as readonly string[]).includes(n) ? (n as AiCapability) : AI_CAPABILITY_ALIASES[n] ?? null;
}

export interface AiCapabilityInfo {
  /** Siempre false: el sistema funciona sin IA (principio del propietario, 2026-09-29). */
  required: false;
  /**
   * Qué entrada necesita el proveedor. Solo "text" viaja por `AiCore.run`; las demás exigen un adaptador que declare
   * la capacidad de forma explícita (hoy ninguno: devuelven UNSUPPORTED).
   */
  modality: "text" | "image" | "video" | "multimodal" | "embedding";
  /** Siempre asíncrona fuera del camino crítico (reportar, mapa, evento, llamar, alertas nunca esperan a la IA). */
  async: true;
  /** Puede costar dinero si el proveedor activo es de pago (pasa por el CostGuard). */
  mayCost: true;
  /** Entra en la primera IA (§21 del mensaje del propietario) o queda para más adelante. */
  phase: "INITIAL" | "LATER";
  /**
   * ¿Puede resolverse sin IA? "YES": la regla determinista cubre la función completa (la IA solo podría afinar);
   * "PARTIAL": la regla cubre lo esencial y la persona o moderación humana completa el resto.
   */
  canBeDeterministic: "YES" | "PARTIAL";
  /** Regla determinista que hace el trabajo sin IA. */
  deterministicFallback: string;
  /** Lo que la capacidad nunca puede hacer. */
  never: readonly string[];
  maxOutputTokens: number;
}

const NEVER_DECIDES = ["producir OFFICIALLY_CONFIRMED o FALSE", "cambiar un estado sin regla ni persona"] as const;

export const AI_CAPABILITY_INFO: Readonly<Record<AiCapability, AiCapabilityInfo>> = {
  ANALYZE_REPORT: {
    required: false, canBeDeterministic: "YES", modality: "text", async: true, mayCost: true, phase: "INITIAL", maxOutputTokens: 256,
    deterministicFallback: "Categoría elegida por la persona, presencia (geo-kit) y reglas de publicación del catálogo",
    never: NEVER_DECIDES,
  },
  CLASSIFY_INCIDENT: {
    required: false, canBeDeterministic: "YES", modality: "text", async: true, mayCost: true, phase: "INITIAL", maxOutputTokens: 64,
    deterministicFallback: "Categoría del reporte o mapeo de palabras clave de la fuente (eventMap)",
    never: NEVER_DECIDES,
  },
  ANALYZE_IMAGE: {
    required: false, canBeDeterministic: "PARTIAL", modality: "image", async: true, mayCost: true, phase: "INITIAL", maxOutputTokens: 128,
    deterministicFallback: "Sanitización EXIF/GPS, hash perceptual y revisión humana en categorías sensibles",
    never: [...NEVER_DECIDES, "identificar personas", "inferir diagnósticos médicos", "declarar oficialmente un desastre"],
  },
  ANALYZE_VIDEO: {
    required: false, canBeDeterministic: "PARTIAL", modality: "video", async: true, mayCost: true, phase: "LATER", maxOutputTokens: 128,
    deterministicFallback: "Límites de duración y tamaño, transcodificación y revisión humana",
    never: [...NEVER_DECIDES, "identificar personas", "inferir diagnósticos médicos"],
  },
  DETECT_DUPLICATE: {
    required: false, canBeDeterministic: "YES", modality: "text", async: true, mayCost: true, phase: "INITIAL", maxOutputTokens: 64,
    deterministicFallback: "Deduplicación por distancia, ventana de tiempo, categoría, H3, huella de texto y hash de media (ADR 0081)",
    never: NEVER_DECIDES,
  },
  SUMMARIZE_INCIDENT: {
    required: false, canBeDeterministic: "YES", modality: "text", async: true, mayCost: true, phase: "INITIAL", maxOutputTokens: 256,
    deterministicFallback: "Título por categoría y lugar, timeline y conteos del evento",
    never: NEVER_DECIDES,
  },
  EXTRACT_INCIDENT_DATA: {
    required: false, canBeDeterministic: "YES", modality: "text", async: true, mayCost: true, phase: "INITIAL", maxOutputTokens: 256,
    deterministicFallback: "Campos estructurados del formulario y del feed CAP/JSON de la fuente",
    never: NEVER_DECIDES,
  },
  MODERATE_CONTENT: {
    required: false, canBeDeterministic: "PARTIAL", modality: "text", async: true, mayCost: true, phase: "INITIAL", maxOutputTokens: 64,
    deterministicFallback: "Detección local de datos personales, denuncias, reputación y cola de moderación humana",
    never: [...NEVER_DECIDES, "retirar contenido sin moderación humana"],
  },
  TRANSLATE_TEXT: {
    required: false, canBeDeterministic: "PARTIAL", modality: "text", async: true, mayCost: true, phase: "LATER", maxOutputTokens: 512,
    deterministicFallback: "Interfaz traducida con catálogos propios; el contenido se muestra en su idioma original",
    never: ["traducir la interfaz", "traducir todo lo guardado sin que nadie lo pida"],
  },
  OPERATIONAL_SUMMARY: {
    required: false, canBeDeterministic: "YES", modality: "text", async: true, mayCost: true, phase: "INITIAL", maxOutputTokens: 512,
    deterministicFallback: "Conteos, agrupaciones geográficas y métricas calculados en PostgreSQL (tablero de calidad y costo)",
    never: [...NEVER_DECIDES, "inventar cifras: solo interpreta las que calcula el backend"],
  },
  GENERATE_EMBEDDING: {
    required: false, canBeDeterministic: "YES", modality: "embedding", async: true, mayCost: true, phase: "LATER", maxOutputTokens: 1,
    deterministicFallback: "Búsqueda por texto (tsvector/trigram), etiquetas, H3 y filtros en PostgreSQL",
    never: [...NEVER_DECIDES, "enviar datos personales o ubicación precisa para vectorizar"],
  },
  SAFETY_CLASSIFICATION: {
    required: false, canBeDeterministic: "PARTIAL", modality: "text", async: true, mayCost: true, phase: "LATER", maxOutputTokens: 64,
    deterministicFallback: "Categorías sensibles del catálogo, retraso de publicación configurable, listas de términos revisadas y moderación humana",
    never: [...NEVER_DECIDES, "retirar contenido sin moderación humana", "acusar a una persona"],
  },
  MULTIMODAL_REASONING: {
    required: false, canBeDeterministic: "PARTIAL", modality: "multimodal", async: true, mayCost: true, phase: "LATER", maxOutputTokens: 256,
    deterministicFallback: "Cada señal por separado con reglas (texto, EXIF saneado, hash perceptual, presencia, fuentes) y revisión humana",
    never: [...NEVER_DECIDES, "identificar personas", "inferir diagnósticos médicos"],
  },
};
