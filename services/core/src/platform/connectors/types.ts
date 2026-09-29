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

/**
 * Tareas en las que la IA PUEDE ayudar. Lista cerrada: añadir una exige un ADR. Ninguna decide sola; todas dejan
 * una sugerencia que una regla o una persona acepta. Nunca produce OFFICIALLY_CONFIRMED ni FALSE.
 */
export const AI_TASKS = ["dedup.ambiguous", "moderation.text_triage", "summary.event", "translation.text"] as const;
export type AiTask = (typeof AI_TASKS)[number];

export interface AiRequest {
  task: AiTask;
  /** Instrucción fija de la tarea (sin datos personales). */
  instructions: string;
  /** Datos de entrada ya minimizados por el AI CORE. */
  input: string;
  maxOutputTokens: number;
}

export interface AiResponse {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
  /** Costo real informado por el proveedor (USD). */
  costUsd: number;
  model: string;
}

/** Adaptador de un proveedor de IA. Uno solo activo a la vez, elegido por configuración (AI_PROVIDER). */
export interface AIProvider extends Connector {
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

// Video en vivo: `LiveStreamProvider` en modules/media (ADR 0015). Mapas: `MapProvider` en la app (ADR 0003).
// Fuentes (clima, sismos, tsunamis…): `FeedAdapter` en modules/ingestion. No se duplican aquí.
