import type { CostGuard } from "../cost-guard.js";
import { AiCore, type AiCallSink } from "./ai-core.js";
import { AiRouter, parseAiRoutes } from "./router.js";
import { FixtureAIProvider, LogSmsProvider, NoAIProvider, NoEmbeddings, NoEmergencyData, NoSms, NoSpeechToText, NoTextToSpeech, NoTranslation, NoVision } from "./disabled.js";
import type { AIProvider, Connector, EmbeddingProvider, EmergencyDataProvider, SmsProvider, SpeechToTextProvider, TextToSpeechProvider, TranslationProvider, VisionProvider } from "./types.js";

export * from "./types.js";
export { AI_BUDGET_KEY, AiCore, minimizeForAi, type AiCallEntry, type AiCallSink, type AiCoreOptions, type AiFailure, type AiOutcome, type AiRunOptions } from "./ai-core.js";
export { checkOutput, runEval, type EvalCase, type EvalReport, type EvalResult } from "./ai-eval.js";
export { AI_MODELS, findModel, modelAccepted, type ModelSpec } from "./models.js";
export { checkPromptRegistry, EVENT_SUMMARY, PROMPTS, promptFingerprint, promptKey, VERIFICATION_HINT, type PromptTemplate } from "./prompts.js";
export { AI_CAPABILITIES, AI_CAPABILITY_ALIASES, AI_CAPABILITY_INFO, canonicalCapability, type AiCapability, type AiCapabilityInfo } from "./capabilities.js";
export { AiRouter, parseAiRoutes, supports } from "./router.js";

/**
 * Registro de adaptadores de IA (ADR 0217). Hoy solo gratuitos y sin red. Un proveedor nuevo (A, B, C, local,
 * autoalojado) se agrega aquí con su adaptador, presupuesto aprobado y COST_MODE=metered; nada más cambia.
 */
export const AI_PROVIDER_FACTORIES = {
  none: () => new NoAIProvider(),
  fixture: () => new FixtureAIProvider(),
} as const satisfies Record<string, () => AIProvider>;
export type AiProviderId = keyof typeof AI_PROVIDER_FACTORIES;
export { FixtureAIProvider, LogSmsProvider, NoAIProvider, NoEmbeddings, NoEmergencyData, NoSms, NoSpeechToText, NoTextToSpeech, NoTranslation, NoVision } from "./disabled.js";

export interface ConnectorConfig {
  /** zero: ningún proveedor de pago puede arrancar. metered: se permiten, siempre detrás del CostGuard. */
  COST_MODE: "zero" | "metered";
  AI_PROVIDER: AiProviderId;
  /** Rutas por capacidad ("CLASSIFY_INCIDENT=fixture;*=none"). Vacío = todas usan AI_PROVIDER. */
  AI_ROUTES?: string;
  AI_TIMEOUT_MS: number;
  TRANSLATION_PROVIDER: "none";
  SMS_PROVIDER: "none" | "log";
  STT_PROVIDER: "none";
  TTS_PROVIDER: "none";
}

export interface Connectors {
  ai: AiCore;
  translation: TranslationProvider;
  sms: SmsProvider;
  stt: SpeechToTextProvider;
  tts: TextToSpeechProvider;
  vision: VisionProvider;
  embeddings: EmbeddingProvider;
  emergencyData: EmergencyDataProvider;
}

export interface ConnectorOverrides {
  /** Proveedor único para todas las capacidades, o varios adaptadores que AI_ROUTES reparte. */
  ai?: AIProvider | AIProvider[]; translation?: TranslationProvider; sms?: SmsProvider; stt?: SpeechToTextProvider; tts?: TextToSpeechProvider;
  vision?: VisionProvider; embeddings?: EmbeddingProvider; emergencyData?: EmergencyDataProvider;
}

/**
 * Arma los conectores según la configuración. Hoy solo hay implementaciones gratuitas (apagadas, de prueba o de log):
 * integrar un proveedor comercial es añadir su adaptador aquí, con presupuesto aprobado y COST_MODE=metered.
 */
export function buildConnectors(cfg: ConnectorConfig, cost: CostGuard, overrides: ConnectorOverrides = {}, aiLog: AiCallSink | null = null): Connectors {
  const override = overrides.ai === undefined ? [] : Array.isArray(overrides.ai) ? overrides.ai : [overrides.ai];
  const base = AI_PROVIDER_FACTORIES[cfg.AI_PROVIDER]();
  const registry = [...override, ...Object.values(AI_PROVIDER_FACTORIES).map((f) => f())].filter((p, i, a) => a.findIndex((q) => q.id === p.id) === i);
  const { routes, defaultChain } = parseAiRoutes(cfg.AI_ROUTES ?? "");
  const router = new AiRouter(registry, routes, defaultChain ?? [override[0]?.id ?? base.id]);
  const chosen = {
    ...Object.fromEntries(router.providers.map((p, i) => [`ai${i}`, p])),
    translation: overrides.translation ?? new NoTranslation(),
    sms: overrides.sms ?? (cfg.SMS_PROVIDER === "log" ? new LogSmsProvider() : new NoSms()),
    stt: overrides.stt ?? new NoSpeechToText(),
    tts: overrides.tts ?? new NoTextToSpeech(),
    vision: overrides.vision ?? new NoVision(),
    embeddings: overrides.embeddings ?? new NoEmbeddings(),
    emergencyData: overrides.emergencyData ?? new NoEmergencyData(),
  };
  if (cfg.COST_MODE === "zero") {
    const paid = Object.entries(chosen as Record<string, Connector>).filter(([, c]) => c.paid).map(([k, c]) => `${k}=${c.id}`);
    if (paid.length) throw new Error(`COST_MODE=zero no permite proveedores de pago: ${paid.join(", ")}`);
  }
  const { translation, sms, stt, tts, vision, embeddings, emergencyData } = chosen;
  return { translation, sms, stt, tts, vision, embeddings, emergencyData, ai: new AiCore(router, cost, {
    timeoutMs: cfg.AI_TIMEOUT_MS, maxInputChars: 4000,
    // Con proveedores reales (de pago) solo se aceptan modelos registrados (ADR 0280).
    enforceModelRegistry: cfg.COST_MODE === "metered",
  }, aiLog) };
}

/** Qué hay activo (para /v1/config de administración y el reporte de costos). Sin secretos. */
export function connectorSummary(c: Connectors): Record<string, string> {
  return {
    ai: c.ai.providerId, translation: c.translation.id, sms: c.sms.id, stt: c.stt.id, tts: c.tts.id,
    vision: c.vision.id, embeddings: c.embeddings.id, emergencyData: c.emergencyData.id,
  };
}
