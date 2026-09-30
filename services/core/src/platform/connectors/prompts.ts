import { createHash } from "node:crypto";
import type { AiCapability } from "./capabilities.js";

/**
 * Registro de prompts versionados del AI CORE (ADR 0280). Cada instrucción que viaja a un modelo vive aquí, con
 * identificador, versión y huella sha256 del texto. Cambiar el texto sin subir la versión y actualizar la huella hace
 * fallar las pruebas: así cada sugerencia guardada dice con qué versión exacta se pidió y una regresión se puede
 * atribuir a un cambio concreto. Las instrucciones nunca llevan datos de personas.
 */
export interface PromptTemplate {
  id: string;
  capability: AiCapability;
  version: number;
  /** sha256 hexadecimal de `text`; se comprueba en las pruebas. */
  sha256: string;
  text: string;
}

export const promptFingerprint = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

/** Pista de verificación para moderación: solo niveles que la IA puede sugerir, nunca OFFICIALLY_CONFIRMED ni FALSE. */
export const VERIFICATION_HINT: PromptTemplate = {
  id: "verification-hint",
  capability: "ANALYZE_REPORT",
  version: 1,
  sha256: "27077bed1c35a5fbb535e8c97d4f2ace2b465e9fd2c19b6fab154a3a58835a59",
  text: [
    "Eres un asistente de moderación de una red de incidentes. Recibes solo hechos agregados de un evento (categoría,",
    "cantidad de reportes por nivel de presencia y confianza, fuentes externas). No recibes textos ni datos de personas.",
    "Responde SOLO con JSON: {\"suggestedLevel\": \"UNVERIFIED\" | \"COMMUNITY_CORROBORATED\" | \"EXTERNALLY_CORROBORATED\" | null,",
    "\"rationale\": string de como máximo 280 caracteres}.",
    "Nunca sugieras OFFICIALLY_CONFIRMED ni FALSE: solo una fuente oficial registrada o una persona pueden decidirlo.",
    "Si los hechos no alcanzan, responde suggestedLevel null.",
  ].join("\n"),
};

/** Resumen operativo de un evento para el equipo de guardia (no se publica). */
export const EVENT_SUMMARY: PromptTemplate = {
  id: "event-summary",
  capability: "SUMMARIZE_INCIDENT",
  version: 1,
  sha256: "907d8a5c933b2820918c54fe5b12f2baf47838e98c933b76ef0750d8d572b9f0",
  text: [
    "Resume en español, en como máximo 3 frases, los hechos agregados de un evento para el equipo de guardia.",
    "No inventes cifras, lugares ni causas. No afirmes que está confirmado oficialmente.",
    "Responde SOLO con JSON: {\"summary\": string}.",
  ].join("\n"),
};

export const PROMPTS: readonly PromptTemplate[] = [VERIFICATION_HINT, EVENT_SUMMARY];

export const promptKey = (p: PromptTemplate): string => `${p.id}@${p.version}`;

/** Problemas del registro: huella que no coincide (texto cambiado sin nueva versión), ids repetidos. */
export function checkPromptRegistry(prompts: readonly PromptTemplate[] = PROMPTS): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of prompts) {
    if (seen.has(p.id)) out.push(`prompt repetido: ${p.id}`);
    seen.add(p.id);
    if (!Number.isInteger(p.version) || p.version < 1) out.push(`${p.id}: versión inválida`);
    const actual = promptFingerprint(p.text);
    if (p.sha256 !== actual) out.push(`${promptKey(p)}: el texto cambió (huella ${actual}); sube la versión y registra la huella nueva`);
  }
  return out;
}
