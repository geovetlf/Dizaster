import type { CostGuard } from "../cost-guard.js";
import { AiCore, type AiCallSink } from "./ai-core.js";
import { FixtureAIProvider, LogSmsProvider, NoAIProvider, NoEmbeddings, NoEmergencyData, NoSms, NoSpeechToText, NoTextToSpeech, NoTranslation, NoVision } from "./disabled.js";
import type { AIProvider, Connector, EmbeddingProvider, EmergencyDataProvider, SmsProvider, SpeechToTextProvider, TextToSpeechProvider, TranslationProvider, VisionProvider } from "./types.js";

export * from "./types.js";
export { AI_BUDGET_KEY, AiCore, minimizeForAi, type AiCallEntry, type AiCallSink, type AiFailure, type AiOutcome, type AiRunOptions } from "./ai-core.js";
export { AI_CAPABILITIES, AI_CAPABILITY_INFO, type AiCapability, type AiCapabilityInfo } from "./capabilities.js";
export { FixtureAIProvider, LogSmsProvider, NoAIProvider, NoEmbeddings, NoEmergencyData, NoSms, NoSpeechToText, NoTextToSpeech, NoTranslation, NoVision } from "./disabled.js";

export interface ConnectorConfig {
  /** zero: ningún proveedor de pago puede arrancar. metered: se permiten, siempre detrás del CostGuard. */
  COST_MODE: "zero" | "metered";
  AI_PROVIDER: "none" | "fixture";
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
  ai?: AIProvider; translation?: TranslationProvider; sms?: SmsProvider; stt?: SpeechToTextProvider; tts?: TextToSpeechProvider;
  vision?: VisionProvider; embeddings?: EmbeddingProvider; emergencyData?: EmergencyDataProvider;
}

/**
 * Arma los conectores según la configuración. Hoy solo hay implementaciones gratuitas (apagadas, de prueba o de log):
 * integrar un proveedor comercial es añadir su adaptador aquí, con presupuesto aprobado y COST_MODE=metered.
 */
export function buildConnectors(cfg: ConnectorConfig, cost: CostGuard, overrides: ConnectorOverrides = {}, aiLog: AiCallSink | null = null): Connectors {
  const aiProvider = overrides.ai ?? (cfg.AI_PROVIDER === "fixture" ? new FixtureAIProvider() : new NoAIProvider());
  const chosen = {
    ai: aiProvider,
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
  return { ...chosen, ai: new AiCore(aiProvider, cost, { timeoutMs: cfg.AI_TIMEOUT_MS, maxInputChars: 4000 }, aiLog) };
}

/** Qué hay activo (para /v1/config de administración y el reporte de costos). Sin secretos. */
export function connectorSummary(c: Connectors): Record<string, string> {
  return {
    ai: c.ai.providerId, translation: c.translation.id, sms: c.sms.id, stt: c.stt.id, tts: c.tts.id,
    vision: c.vision.id, embeddings: c.embeddings.id, emergencyData: c.emergencyData.id,
  };
}
