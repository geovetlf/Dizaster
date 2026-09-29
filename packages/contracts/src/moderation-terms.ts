import { z } from "zod";
import { FlagReason } from "./moderation.js";

/**
 * Listas de términos por idioma (§5.12 "listas", ADR 0148): primera línea determinista de moderación. Un texto que
 * contiene un término entra en la cola de revisión con el motivo del término; nunca se oculta ni se rechaza solo.
 * Las listas viven en data/moderation/terms.json y empiezan vacías (decisión del propietario). NO AI REQUIRED.
 */
export const ModerationTerm = z.object({ term: z.string().trim().min(2).max(80), reason: FlagReason });
export type ModerationTerm = z.infer<typeof ModerationTerm>;
export const ModerationTermList = z.object({
  version: z.string(),
  note: z.string().optional(),
  languages: z.record(z.string().regex(/^[a-z]{2}$/), z.array(ModerationTerm).max(5000)),
});
export type ModerationTermList = z.infer<typeof ModerationTermList>;

/** Minúsculas, sin tildes, solo letras y dígitos separados por un espacio, con espacios en los bordes. */
export function normalizeForTerms(text: string): string {
  const plain = text.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return ` ${plain} `;
}

export interface CompiledTerms { entries: { term: string; needle: string; reason: FlagReason }[] }

/** Prepara las listas de todos los idiomas (el idioma detectado de un texto corto no es fiable). */
export function compileTerms(list: ModerationTermList): CompiledTerms {
  const seen = new Set<string>();
  const entries: CompiledTerms["entries"] = [];
  for (const terms of Object.values(list.languages)) {
    for (const t of terms) {
      const needle = normalizeForTerms(t.term);
      if (needle.trim().length < 2 || seen.has(`${needle}|${t.reason}`)) continue;
      seen.add(`${needle}|${t.reason}`);
      entries.push({ term: t.term, needle, reason: t.reason });
    }
  }
  return { entries };
}

/** Términos presentes como palabra o frase completa (no dentro de otra palabra). Lista vacía → nunca coincide. */
export function matchTerms(text: string, compiled: CompiledTerms): { term: string; reason: FlagReason }[] {
  if (compiled.entries.length === 0) return [];
  const hay = normalizeForTerms(text);
  return compiled.entries.filter((e) => hay.includes(e.needle)).map(({ term, reason }) => ({ term, reason }));
}
