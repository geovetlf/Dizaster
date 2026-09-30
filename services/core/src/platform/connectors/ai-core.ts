import type { CostGuard } from "../cost-guard.js";
import { AI_CAPABILITY_INFO, type AiCapability } from "./capabilities.js";
import { AiRouter } from "./router.js";
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
 * AI CORE (ADR 0064, ADR 0110, ADR 0217): el único punto por el que el sistema usa IA. Opcional y reemplazable; el
 * AI ROUTER decide qué proveedores atienden cada capacidad (apagado por defecto). Reglas:
 * - Nunca lanza: cualquier problema devuelve `ok: false` y quien llama sigue con su regla determinista
 *   (`AI_CAPABILITY_INFO[c].deterministicFallback`).
 * - Si un proveedor falla, se agota su tiempo o no tiene presupuesto, prueba el siguiente de la ruta.
 * - Imagen, video, multimodal y embeddings solo con un adaptador que los declare (si no, UNSUPPORTED).
 * - Antes de gastar pregunta al CostGuard (kill switch "ai" + presupuesto); después registra el costo real.
 * - Minimiza la entrada y corta a `timeoutMs`.
 * - Cada intento con la IA encendida queda registrado sin contenido (AiCallSink). Apagada no escribe nada.
 * - No decide nada: los módulos guardan el resultado como sugerencia (p. ej. verification.recordAiSuggestion, que
 *   rechaza OFFICIALLY_CONFIRMED).
 */
export class AiCore {
  private readonly router: AiRouter;

  constructor(
    routerOrProvider: AiRouter | AIProvider,
    private readonly cost: CostGuard,
    private readonly opts: { timeoutMs: number; maxInputChars: number } = { timeoutMs: 8000, maxInputChars: 4000 },
    private readonly sink: AiCallSink | null = null,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.router = routerOrProvider instanceof AiRouter ? routerOrProvider : AiRouter.single(routerOrProvider);
  }

  get enabled(): boolean { return this.router.enabled; }
  get providerId(): string { return this.router.summary; }
  /** Si hay al menos un proveedor configurado que puede atender la capacidad. */
  available(capability: AiCapability): boolean { return this.router.eligible(capability).length > 0; }

  async run(capability: AiCapability, instructions: string, rawInput: string, options: AiRunOptions = {}): Promise<AiOutcome> {
    const configured = this.router.configured(capability);
    if (configured.length === 0) return { ok: false, reason: "DISABLED" };
    const info = AI_CAPABILITY_INFO[capability];
    const record = async (provider: string, outcome: AiOutcome, started: number, estimate: number, usage = { inputTokens: 0, outputTokens: 0 }, model: string | null = null) => {
      await this.sink?.recordAiCall({
        capability, provider, model, status: outcome.ok ? "OK" : outcome.reason, fallback: !outcome.ok,
        latencyMs: Math.max(0, Math.round(this.now() - started)), inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
        estimatedUsd: estimate, usd: outcome.ok ? outcome.costUsd : 0, subject: options.subject ?? null, actorUserId: options.actorUserId ?? null,
      }).catch(() => undefined);
      return outcome;
    };
    const chain = this.router.eligible(capability);
    if (chain.length === 0) return record(configured[0]!.id, { ok: false, reason: "UNSUPPORTED" }, this.now(), 0);
    try {
      if (await this.cost.isKilled(AI_BUDGET_KEY)) return record(chain[0]!.id, { ok: false, reason: "KILLED" }, this.now(), 0);
    } catch {
      return record(chain[0]!.id, { ok: false, reason: "ERROR" }, this.now(), 0);
    }
    const req = {
      capability, instructions, input: minimizeForAi(rawInput).slice(0, this.opts.maxInputChars),
      maxOutputTokens: Math.min(options.maxOutputTokens ?? info.maxOutputTokens, info.maxOutputTokens),
    };
    let last: AiOutcome = { ok: false, reason: "ERROR" };
    for (const provider of chain) {
      last = await this.attempt(provider, req, record);
      if (last.ok) return last;
    }
    return last;
  }

  private async attempt(
    provider: AIProvider, req: Parameters<AIProvider["complete"]>[0],
    record: (provider: string, o: AiOutcome, started: number, estimate: number, usage?: { inputTokens: number; outputTokens: number }, model?: string | null) => Promise<AiOutcome>,
  ): Promise<AiOutcome> {
    const started = this.now();
    let estimate = 0;
    try {
      estimate = provider.estimateUsd(req);
      if (provider.paid && !(await this.cost.check(AI_BUDGET_KEY, estimate))) return record(provider.id, { ok: false, reason: "NO_BUDGET" }, started, estimate);
      const ctl = new AbortController();
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<"timeout">((resolve) => { timer = setTimeout(() => { ctl.abort(); resolve("timeout"); }, this.opts.timeoutMs); });
      const res = await Promise.race([provider.complete(req, ctl.signal), timeout]).finally(() => clearTimeout(timer));
      if (res === "timeout") return record(provider.id, { ok: false, reason: "TIMEOUT" }, started, estimate);
      if (res.costUsd > 0) {
        await this.cost.record(AI_BUDGET_KEY, res.costUsd, { provider: provider.id, units: res.usage.inputTokens + res.usage.outputTokens });
      }
      return record(provider.id, { ok: true, text: res.text, model: res.model, provider: provider.id, costUsd: res.costUsd }, started, estimate, res.usage, res.model);
    } catch {
      return record(provider.id, { ok: false, reason: "ERROR" }, started, estimate);
    }
  }
}
