import type { AiCapability } from "./capabilities.js";

/**
 * Registro de modelos del AI CORE (ADR 0280). Qué modelo sirve cada adaptador, para qué capacidades y en qué estado.
 * Hoy solo existe el de pruebas: ningún modelo comercial está integrado (principio de IA mínima). Un modelo nuevo se
 * registra aquí con su ADR; el costo por token no se escribe hasta tener el precio publicado y el presupuesto
 * aprobado (null = desconocido: el CostGuard usa la estimación del adaptador).
 */
export interface ModelSpec {
  /** Proveedor (id del adaptador en AI_PROVIDER_FACTORIES). */
  provider: string;
  /** Nombre del modelo tal como lo devuelve el adaptador en `AiResponse.model`. */
  model: string;
  capabilities: readonly AiCapability[];
  status: "ACTIVE" | "DEPRECATED" | "RETIRED";
  /** Datos a terceros: "none" si corre sin red (local o de prueba). */
  dataEgress: "none" | "provider";
  usdPer1kInputTokens: number | null;
  usdPer1kOutputTokens: number | null;
}

export const AI_MODELS: readonly ModelSpec[] = [
  {
    provider: "fixture", model: "fixture", status: "ACTIVE", dataEgress: "none", usdPer1kInputTokens: 0, usdPer1kOutputTokens: 0,
    capabilities: ["ANALYZE_REPORT", "CLASSIFY_INCIDENT", "EXTRACT_INCIDENT_DATA", "DETECT_DUPLICATE", "TRANSLATE_TEXT", "SUMMARIZE_INCIDENT", "MODERATE_CONTENT", "SAFETY_CLASSIFICATION", "OPERATIONAL_SUMMARY"],
  },
];

export const findModel = (provider: string, model: string): ModelSpec | undefined =>
  AI_MODELS.find((m) => m.provider === provider && m.model === model);

/**
 * ¿Se acepta la respuesta de este modelo? Solo modelos registrados, activos y declarados para la capacidad: un
 * proveedor que cambie de modelo sin aviso no entra en producción sin revisión.
 */
export function modelAccepted(provider: string, model: string, capability: AiCapability): boolean {
  const m = findModel(provider, model);
  return m !== undefined && m.status === "ACTIVE" && m.capabilities.includes(capability);
}
