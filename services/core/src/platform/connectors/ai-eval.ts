import type { AiCore } from "./ai-core.js";
import type { PromptTemplate } from "./prompts.js";

/**
 * Evaluación y regresión de la IA (ADR 0280), determinística: casos con entrada y expectativas verificables por código
 * (JSON válido, campos, palabras prohibidas, largo). Se corre con cualquier proveedor configurado; en CI con proveedores
 * de prueba, y antes de activar un proveedor real, contra ese proveedor (con presupuesto aprobado).
 */
export interface EvalCase {
  name: string;
  input: string;
  expect: {
    /** Campos JSON obligatorios y sus valores permitidos (null permitido si está en la lista). */
    fields?: Record<string, readonly (string | null)[] | "string">;
    /** Nunca debe aparecer (p. ej. OFFICIALLY_CONFIRMED). */
    forbidden?: readonly string[];
    maxChars?: number;
  };
}

export interface EvalResult { name: string; ok: boolean; problems: string[]; status: string }
export interface EvalReport { prompt: string; passed: number; failed: number; results: EvalResult[] }

export function checkOutput(text: string, e: EvalCase["expect"]): string[] {
  const problems: string[] = [];
  if (e.maxChars !== undefined && text.length > e.maxChars) problems.push(`largo ${text.length} > ${e.maxChars}`);
  for (const f of e.forbidden ?? []) if (text.includes(f)) problems.push(`contiene "${f}"`);
  if (e.fields) {
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return [...problems, "no es JSON"];
    }
    if (json === null || typeof json !== "object" || Array.isArray(json)) return [...problems, "no es un objeto JSON"];
    for (const [k, allowed] of Object.entries(e.fields)) {
      if (!(k in json)) { problems.push(`falta ${k}`); continue; }
      const v = json[k];
      if (allowed === "string") { if (typeof v !== "string") problems.push(`${k} no es texto`); }
      else if (!allowed.includes(v as string | null)) problems.push(`${k}=${JSON.stringify(v)} no permitido`);
    }
  }
  return problems;
}

export async function runEval(core: AiCore, prompt: PromptTemplate, cases: readonly EvalCase[]): Promise<EvalReport> {
  const results: EvalResult[] = [];
  for (const c of cases) {
    const out = await core.run(prompt.capability, prompt, c.input);
    if (!out.ok) { results.push({ name: c.name, ok: false, problems: [`sin respuesta: ${out.reason}`], status: out.reason }); continue; }
    const problems = checkOutput(out.text, c.expect);
    results.push({ name: c.name, ok: problems.length === 0, problems, status: "OK" });
  }
  return { prompt: `${prompt.id}@${prompt.version}`, passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
}
