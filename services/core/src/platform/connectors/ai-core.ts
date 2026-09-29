import type { CostGuard } from "../cost-guard.js";
import { AI_CAPABILITY_INFO, type AiCapability } from "./capabilities.js";
import type { AIProvider } from "./types.js";

/** Clave de presupuesto y kill switch de toda la IA (ADR 0019). */
export const AI_BUDGET_KEY = "ai";

export type AiFailure = "DISABLED" | "KILLED" | "NO_BUDGET" | "TIMEOUT" | "ERROR" | "UNSUPPORTED";
export type AiOutcome =
  | { ok: true; text: string; model: string; provider: string; costUsd: number }
  | { ok: false; reason: AiFailure };

/**
 * Una llamada al AI CORE para observabilidad y costo (ADR 0110): sin contenido (ni instrucciones, ni entrada, ni
 * salida). `fallback` = quien llama siguió con su regla determinista. Se mide por capacidad, proveedor, modelo,
 * persona, evento y periodo.
 */
export interface AiCallEntry {
  capability: AiCapability;
  provider: string;
  model: string | null;
  status: "OK" | AiFailure;
  fallback: boolean;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  estimatedUsd: number;
  usd: number;
  subject: { type: "EVENT" | "REPORT" | "POST" | "COMMENT" | "MEDIA"; id: string } | null;
  actorUserId: string | null;
}

export interface AiCallSink {
  recordAiCall(entry: AiCallEntry): Promise<void>;
}

export interface AiRunOptions {
  maxOutputTokens?: number;
  /** Sobre qué se pidió (para medir costo por evento o reporte). */
  subject?: AiCallEntry["subject"];
  /** Quién lo provocó, si fue una persona (moderación, operación). */
  actorUserId?: string | null;
}

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
 * AI CORE (ADR 0064, ADR 0110): el único punto por el que el sistema usa IA. Opcional y reemplazable: un solo
 * proveedor activo, elegido por configuración y apagado por defecto. Reglas:
 * - Nunca lanza: cualquier problema devuelve `ok: false` y quien llama sigue con su regla determinista
 *   (`AI_CAPABILITY_INFO[c].deterministicFallback`).
 * - Solo capacidades de texto: imagen y video esperan un VisionProvider (UNSUPPORTED).
 * - Antes de gastar pregunta al CostGuard (kill switch "ai" + presupuesto); después registra el costo real.
 * - Minimiza la entrada y corta a `timeoutMs`.
 * - Cada intento con la IA encendida queda registrado sin contenido (AiCallSink). Apagada no escribe nada.
 * - No decide nada: los módulos guardan el resultado como sugerencia (p. ej. verification.recordAiSuggestion, que
 *   rechaza OFFICIALLY_CONFIRMED).
 */
export class AiCore {
  constructor(
    private readonly provider: AIProvider,
    private readonly cost: CostGuard,
    private readonly opts: { timeoutMs: number; maxInputChars: number } = { timeoutMs: 8000, maxInputChars: 4000 },
    private readonly sink: AiCallSink | null = null,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get enabled(): boolean { return this.provider.id !== "none"; }
  get providerId(): string { return this.provider.id; }

  async run(capability: AiCapability, instructions: string, rawInput: string, options: AiRunOptions = {}): Promise<AiOutcome> {
    if (!this.enabled) return { ok: false, reason: "DISABLED" };
    const info = AI_CAPABILITY_INFO[capability];
    const started = this.now();
    let estimate = 0;
    const finish = async (outcome: AiOutcome, usage = { inputTokens: 0, outputTokens: 0 }, model: string | null = null): Promise<AiOutcome> => {
      await this.sink?.recordAiCall({
        capability, provider: this.provider.id, model, status: outcome.ok ? "OK" : outcome.reason, fallback: !outcome.ok,
        latencyMs: Math.max(0, Math.round(this.now() - started)), inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
        estimatedUsd: estimate, usd: outcome.ok ? outcome.costUsd : 0, subject: options.subject ?? null, actorUserId: options.actorUserId ?? null,
      }).catch(() => undefined);
      return outcome;
    };
    if (info.modality !== "text") return finish({ ok: false, reason: "UNSUPPORTED" });
    try {
      if (await this.cost.isKilled(AI_BUDGET_KEY)) return finish({ ok: false, reason: "KILLED" });
      const req = {
        capability, instructions, input: minimizeForAi(rawInput).slice(0, this.opts.maxInputChars),
        maxOutputTokens: Math.min(options.maxOutputTokens ?? info.maxOutputTokens, info.maxOutputTokens),
      };
      estimate = this.provider.estimateUsd(req);
      if (this.provider.paid && !(await this.cost.check(AI_BUDGET_KEY, estimate))) return finish({ ok: false, reason: "NO_BUDGET" });
      const ctl = new AbortController();
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<"timeout">((resolve) => { timer = setTimeout(() => { ctl.abort(); resolve("timeout"); }, this.opts.timeoutMs); });
      const res = await Promise.race([this.provider.complete(req, ctl.signal), timeout]).finally(() => clearTimeout(timer));
      if (res === "timeout") return finish({ ok: false, reason: "TIMEOUT" });
      if (res.costUsd > 0) {
        await this.cost.record(AI_BUDGET_KEY, res.costUsd, { provider: this.provider.id, units: res.usage.inputTokens + res.usage.outputTokens });
      }
      return finish({ ok: true, text: res.text, model: res.model, provider: this.provider.id, costUsd: res.costUsd }, res.usage, res.model);
    } catch {
      return finish({ ok: false, reason: "ERROR" });
    }
  }
}
