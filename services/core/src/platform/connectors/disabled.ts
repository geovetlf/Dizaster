import type { AIProvider, AiRequest, AiResponse, EmbeddingProvider, EmergencyDataProvider, SmsProvider, SpeechToTextProvider, TextToSpeechProvider, TranslationProvider, VisionProvider } from "./types.js";

/** IA apagada (por defecto). El AI CORE ni siquiera la llama: devuelve "desactivada" y el llamador usa su regla. */
export class NoAIProvider implements AIProvider {
  readonly id = "none";
  readonly paid = false;
  estimateUsd(): number { return 0; }
  async complete(): Promise<AiResponse> { throw new Error("AI desactivada"); }
}

/**
 * IA de prueba y desarrollo: respuestas fijas por tarea, sin red ni costo. Sirve para ver el flujo completo en modo
 * costo cero y en las pruebas (fallo, timeout y presupuesto se simulan con `behaviour`).
 */
export class FixtureAIProvider implements AIProvider {
  readonly id: string = "fixture";
  readonly paid: boolean = false;
  readonly calls: AiRequest[] = [];
  behaviour: "ok" | "fail" | "hang" = "ok";
  constructor(private readonly answers: Partial<Record<AiRequest["capability"], string>> = {}, private readonly price = 0) {}
  estimateUsd(): number { return this.price; }
  async complete(req: AiRequest, signal: AbortSignal): Promise<AiResponse> {
    this.calls.push(req);
    if (this.behaviour === "fail") throw new Error("fixture: fallo simulado");
    if (this.behaviour === "hang") {
      await new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    }
    const text = this.answers[req.capability] ?? "{}";
    return { text, usage: { inputTokens: Math.ceil(req.input.length / 4), outputTokens: Math.ceil(text.length / 4) }, costUsd: this.price, model: "fixture" };
  }
}

export class NoTranslation implements TranslationProvider {
  readonly id = "none";
  readonly paid = false;
  async translate(_text: string, _from: string | null, _to: string): Promise<string | null> { return null; }
}

/** SMS de desarrollo: no envía nada, solo deja constancia (sin el número completo ni el texto). */
export class LogSmsProvider implements SmsProvider {
  readonly id = "log";
  readonly paid = false;
  readonly sent: { to: string; length: number }[] = [];
  async send(to: string, text: string): Promise<{ accepted: boolean; reason?: string }> {
    const masked = to.length > 4 ? `${"*".repeat(to.length - 4)}${to.slice(-4)}` : "****";
    this.sent.push({ to: masked, length: text.length });
    console.info(JSON.stringify({ msg: "sms.log", to: masked, length: text.length }));
    return { accepted: true };
  }
}

export class NoSms implements SmsProvider {
  readonly id = "none";
  readonly paid = false;
  async send(_to: string, _text: string): Promise<{ accepted: boolean; reason?: string }> { return { accepted: false, reason: "DISABLED" }; }
}

export class NoSpeechToText implements SpeechToTextProvider {
  readonly id = "none";
  readonly paid = false;
  async transcribe(_audio: Uint8Array, _mime: string, _lang: string | null): Promise<string | null> { return null; }
}

export class NoTextToSpeech implements TextToSpeechProvider {
  readonly id = "none";
  readonly paid = false;
  async synthesize(_text: string, _lang: string): Promise<Uint8Array | null> { return null; }
}

export class NoVision implements VisionProvider {
  readonly id = "none";
  readonly paid = false;
  async describe(): Promise<null> { return null; }
}

export class NoEmbeddings implements EmbeddingProvider {
  readonly id = "none";
  readonly paid = false;
  async embed(): Promise<null> { return null; }
}

export class NoEmergencyData implements EmergencyDataProvider {
  readonly id = "none";
  readonly paid = false;
  async numbersFor(): Promise<null> { return null; }
}
