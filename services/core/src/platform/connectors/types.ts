import type { AiCapability } from "./capabilities.js";

/**
 * Source Connector Layer / proveedores reemplazables (ADR 0064). Toda capacidad que podría depender de un tercero se
 * declara aquí como interfaz; el resto del código nunca llama a una API externa directamente. Cada proveedor dice si
 * cuesta dinero (`paid`): en modo costo cero (COST_MODE=zero, por defecto) el arranque rechaza cualquiera de pago.
 */
export interface Connector {
  /** Identificador estable ("none", "fixture", "log", "<proveedor>-<producto>"). */
  readonly id: string;
  /** true si cada uso cuesta dinero. Todo proveedor de pago pasa además por el CostGuard antes de gastar. */
  readonly paid: boolean;
}

// ───────────── AI CORE ─────────────

/** Capacidades en las que la IA PUEDE ayudar: catálogo cerrado en capabilities.ts (ADR 0110, antes AI_TASKS). */
export interface AiRequest {
  capability: AiCapability;
  /** Instrucción fija de la tarea (sin datos personales). */
  instructions: string;
  /** Datos de entrada ya minimizados por el AI CORE. */
  input: string;
  maxOutputTokens: number;
}

/**
 * Error tipado de un adaptador (ADR 0280). `RATE_LIMITED` (p. ej. HTTP 429) hace que el AI CORE deje de llamar a ese
 * proveedor durante `retryAfterMs` (o la espera del cortocircuito) y pruebe el siguiente de la ruta.
 */
export class AiProviderError extends Error {
  constructor(readonly kind: "RATE_LIMITED" | "ERROR", message: string, readonly retryAfterMs?: number) {
    super(message);
    this.name = "AiProviderError";
  }
}

export interface AiResponse {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
  /** Costo real informado por el proveedor (USD). */
  costUsd: number;
  model: string;
}

/**
 * PROVIDER ADAPTER: adaptador de un proveedor o modelo de IA (ADR 0217). El AI ROUTER elige cuáles atienden cada
 * capacidad (AI_ROUTES / AI_PROVIDER). Hablar con un proveedor nuevo = implementar esta interfaz y registrarlo en
 * `AI_PROVIDER_FACTORIES`; la lógica de negocio no cambia.
 */
export interface AIProvider extends Connector {
  /**
   * Capacidades que atiende. Sin declarar: todas las de texto. Imagen, video, multimodal y embeddings requieren
   * declararlas de forma explícita.
   */
  readonly capabilities?: readonly AiCapability[];
  /** Estimación previa (USD) para pedir permiso al CostGuard antes de llamar. */
  estimateUsd(req: AiRequest): number;
  complete(req: AiRequest, signal: AbortSignal): Promise<AiResponse>;
}

// ───────────── Traducción ─────────────

export interface TranslationProvider extends Connector {
  /** null = no hay traducción: la app muestra el original (nunca bloquea). */
  translate(text: string, from: string | null, to: string): Promise<string | null>;
}

// ───────────── SMS ─────────────

export interface SmsProvider extends Connector {
  /** Envía un SMS. `accepted: false` si no se envió (desactivado, sin presupuesto, error). Nunca lanza. */
  send(to: string, text: string): Promise<{ accepted: boolean; reason?: string }>;
}

// ───────────── Voz ─────────────

export interface SpeechToTextProvider extends Connector {
  /** null = sin transcripción. El reporte nunca depende de esto. */
  transcribe(audio: Uint8Array, mime: string, lang: string | null): Promise<string | null>;
}

export interface TextToSpeechProvider extends Connector {
  /** null = sin audio del servidor. En el teléfono la síntesis del sistema operativo es gratis. */
  synthesize(text: string, lang: string): Promise<Uint8Array | null>;
}

// ───────────── Visión, embeddings y datos de emergencia (ADR 0110) ─────────────

/** Análisis de imagen/video. Hoy apagado: ANALYZE_IMAGE/ANALYZE_VIDEO devuelven "no disponible". */
export interface VisionProvider extends Connector {
  /** null = sin análisis (la media sigue su flujo determinista y humano). */
  describe(media: Uint8Array, mime: string, instructions: string): Promise<{ text: string; costUsd: number; model: string } | null>;
}

/** Embeddings: solo cuando la búsqueda semántica gane a PostgreSQL, trigram, H3 y filtros. Hoy apagado. */
export interface EmbeddingProvider extends Connector {
  /** null = sin vector; quien llama usa búsqueda determinista. */
  embed(text: string): Promise<number[] | null>;
}

/** Datos de emergencia externos (p. ej. APIs de despacho). Hoy apagado: los números vienen de /data. */
export interface EmergencyDataProvider extends Connector {
  /** null = usar el registro propio de números por país y categoría. */
  numbersFor(country: string, category: string): Promise<{ number: string; service: string }[] | null>;
}

// Video en vivo: `LiveStreamProvider` en modules/media (ADR 0015). Mapas: `MapProvider` en la app (ADR 0003).
// Fuentes (clima, sismos, tsunamis…): `FeedAdapter` en modules/ingestion. No se duplican aquí.
