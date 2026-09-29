import type { CostGuard } from "../cost-guard.js";
import type { AIProvider, AiTask } from "./types.js";

/** Clave de presupuesto y kill switch de toda la IA (ADR 0019). */
export const AI_BUDGET_KEY = "ai";

export type AiOutcome =
  | { ok: true; text: string; model: string; provider: string; costUsd: number }
  | { ok: false; reason: "DISABLED" | "KILLED" | "NO_BUDGET" | "TIMEOUT" | "ERROR" };

/**
 * Minimización antes de enviar nada a un tercero (Blueprint §13): quita correos, teléfonos, coordenadas y URLs.
 * Determinista; se aplica siempre, aunque el proveedor sea local.
 */
export function minimizeForAi(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/-?\d{1,3}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}/g, "[coords]")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "[phone]");
}

/**
 * AI CORE (ADR 0064): el único punto por el que el sistema usa IA. Opcional y reemplazable: el proveedor se elige por
 * configuración y está apagado por defecto. Reglas:
 * - Nunca lanza: cualquier problema devuelve `ok: false` y quien llama sigue con su regla determinista.
 * - Antes de gastar pregunta al CostGuard (kill switch "ai" + presupuesto); después registra el costo real.
 * - Minimiza la entrada y corta a `timeoutMs`.
 * - No decide nada: los módulos guardan el resultado como sugerencia (p. ej. verification.recordAiSuggestion, que
 *   rechaza OFFICIALLY_CONFIRMED).
 */
export class AiCore {
  constructor(
    private readonly provider: AIProvider,
    private readonly cost: CostGuard,
    private readonly opts: { timeoutMs: number; maxInputChars: number } = { timeoutMs: 8000, maxInputChars: 4000 },
  ) {}

  get enabled(): boolean { return this.provider.id !== "none"; }
  get providerId(): string { return this.provider.id; }

  async run(task: AiTask, instructions: string, rawInput: string, maxOutputTokens = 256): Promise<AiOutcome> {
    if (!this.enabled) return { ok: false, reason: "DISABLED" };
    try {
      if (await this.cost.isKilled(AI_BUDGET_KEY)) return { ok: false, reason: "KILLED" };
      const req = { task, instructions, input: minimizeForAi(rawInput).slice(0, this.opts.maxInputChars), maxOutputTokens };
      const estimate = this.provider.estimateUsd(req);
      if (this.provider.paid && !(await this.cost.check(AI_BUDGET_KEY, estimate))) return { ok: false, reason: "NO_BUDGET" };
      const ctl = new AbortController();
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<"timeout">((resolve) => { timer = setTimeout(() => { ctl.abort(); resolve("timeout"); }, this.opts.timeoutMs); });
      const res = await Promise.race([this.provider.complete(req, ctl.signal), timeout]).finally(() => clearTimeout(timer));
      if (res === "timeout") return { ok: false, reason: "TIMEOUT" };
      if (res.costUsd > 0) {
        await this.cost.record(AI_BUDGET_KEY, res.costUsd, { provider: this.provider.id, units: res.usage.inputTokens + res.usage.outputTokens });
      }
      return { ok: true, text: res.text, model: res.model, provider: this.provider.id, costUsd: res.costUsd };
    } catch {
      return { ok: false, reason: "ERROR" };
    }
  }
}
