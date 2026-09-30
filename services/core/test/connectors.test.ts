import { describe, expect, it } from "vitest";
import {
  AI_CAPABILITIES, AI_CAPABILITY_INFO, AiCore, FixtureAIProvider, type AiCallEntry, LogSmsProvider, NoAIProvider, NoSms, NoTranslation, buildConnectors, connectorSummary, minimizeForAi,
  type AIProvider, type AiRequest, type ConnectorConfig,
} from "../src/platform/connectors/index.js";
import type { CostGuard } from "../src/platform/cost-guard.js";
import { loadEnv } from "../src/platform/config.js";

/** CostGuard en memoria: presupuesto, kill switch y gasto registrado. */
class MemoryGuard implements CostGuard {
  spent = 0;
  constructor(public budget = 0, public killed = false) {}
  async check(_key: string, usd: number) { return !this.killed && this.spent + usd <= this.budget; }
  async record(_key: string, usd: number) { this.spent += usd; }
  async isKilled() { return this.killed; }
}

class PaidFixture extends FixtureAIProvider {
  override readonly id = "paid-fixture";
  override readonly paid = true;
}

const cfg: ConnectorConfig = {
  COST_MODE: "zero", AI_PROVIDER: "none", AI_TIMEOUT_MS: 8000, TRANSLATION_PROVIDER: "none", SMS_PROVIDER: "none", STT_PROVIDER: "none", TTS_PROVIDER: "none",
};

describe("conectores y modo costo cero (ADR 0064)", () => {
  it("por defecto todo está apagado y es gratis", () => {
    const env = loadEnv({ DATABASE_URL: "postgres://x", AUTH_JWT_SECRET: "s".repeat(32) } as NodeJS.ProcessEnv);
    expect(env).toMatchObject({ COST_MODE: "zero", AI_PROVIDER: "none", SMS_PROVIDER: "none", TRANSLATION_PROVIDER: "none" });
    const c = buildConnectors(env, new MemoryGuard());
    expect(connectorSummary(c)).toEqual({ ai: "none", translation: "none", sms: "none", stt: "none", tts: "none", vision: "none", embeddings: "none", emergencyData: "none" });
    expect(c.ai.enabled).toBe(false);
  });

  it("modo costo cero: un proveedor de pago no arranca", () => {
    expect(() => buildConnectors(cfg, new MemoryGuard(), { ai: new PaidFixture() })).toThrow(/COST_MODE=zero/);
    expect(() => buildConnectors({ ...cfg, COST_MODE: "metered" }, new MemoryGuard(), { ai: new PaidFixture() })).not.toThrow();
  });

  it("producción no acepta proveedores de prueba", () => {
    const base = { NODE_ENV: "production", DATABASE_URL: "postgres://x", AUTH_JWT_SECRET: "s".repeat(32), FIELD_KEYS: "k:x", PUSH_DRIVER: "live", STORAGE_DRIVER: "s3", S3_ENDPOINT: "e", S3_BUCKET: "b", S3_ACCESS_KEY_ID: "a", S3_SECRET_ACCESS_KEY: "s" };
    expect(() => loadEnv({ ...base, AI_PROVIDER: "fixture" } as NodeJS.ProcessEnv)).toThrow(/solo para desarrollo/);
    expect(() => loadEnv(base as NodeJS.ProcessEnv)).not.toThrow();
  });
});

describe("AI CORE (ADR 0064)", () => {
  it("apagada: no llama a nadie y devuelve DISABLED", async () => {
    const core = new AiCore(new NoAIProvider(), new MemoryGuard(100));
    expect(await core.run("SUMMARIZE_INCIDENT", "resume", "texto")).toEqual({ ok: false, reason: "DISABLED" });
  });

  it("con proveedor: responde y registra el costo real", async () => {
    const guard = new MemoryGuard(1);
    const p = new PaidFixture({ "DETECT_DUPLICATE": '{"same":true}' }, 0.002);
    const r = await new AiCore(p, guard).run("DETECT_DUPLICATE", "¿mismo evento?", "a | b");
    expect(r).toMatchObject({ ok: true, text: '{"same":true}', provider: "paid-fixture" });
    expect(guard.spent).toBeCloseTo(0.002);
  });

  it("kill switch y presupuesto agotado: no gasta", async () => {
    const p = new PaidFixture({}, 0.5);
    expect(await new AiCore(p, new MemoryGuard(100, true)).run("SUMMARIZE_INCIDENT", "x", "y")).toEqual({ ok: false, reason: "KILLED" });
    expect(await new AiCore(p, new MemoryGuard(0.1)).run("SUMMARIZE_INCIDENT", "x", "y")).toEqual({ ok: false, reason: "NO_BUDGET" });
    expect(p.calls).toHaveLength(0);
  });

  it("un fallo o un proveedor colgado nunca lanza: el llamador sigue con su regla", async () => {
    const p = new FixtureAIProvider();
    p.behaviour = "fail";
    expect(await new AiCore(p, new MemoryGuard()).run("SUMMARIZE_INCIDENT", "x", "y")).toEqual({ ok: false, reason: "ERROR" });
    p.behaviour = "hang";
    const started = Date.now();
    expect(await new AiCore(p, new MemoryGuard(), { timeoutMs: 50, maxInputChars: 100 }).run("SUMMARIZE_INCIDENT", "x", "y")).toEqual({ ok: false, reason: "TIMEOUT" });
    expect(Date.now() - started).toBeLessThan(2000);
    const broken: AIProvider = { id: "broken", paid: false, estimateUsd: () => { throw new Error("x"); }, complete: async () => { throw new Error("x"); } };
    expect(await new AiCore(broken, new MemoryGuard()).run("SUMMARIZE_INCIDENT", "x", "y")).toEqual({ ok: false, reason: "ERROR" });
  });

  it("privacidad: minimiza la entrada antes de enviarla", async () => {
    const p = new FixtureAIProvider();
    await new AiCore(p, new MemoryGuard(), { timeoutMs: 1000, maxInputChars: 200 }).run(
      "MODERATE_CONTENT", "x", "Escríbeme a ana@mail.com o al +51 987 654 321, estoy en -12.04637, -77.04279 https://maps.example/x",
    );
    const sent = (p.calls[0] as AiRequest).input;
    expect(sent).not.toMatch(/ana@mail|987|12\.04637|maps\.example/);
    expect(sent).toContain("[email]");
    expect(minimizeForAi("x".repeat(10))).toBe("x".repeat(10));
  });
});

describe("conectores sin IA", () => {
  it("traducción apagada devuelve null (la app muestra el original)", async () => {
    expect(await new NoTranslation().translate("hola", "es", "en")).toBeNull();
  });

  it("SMS: apagado no envía; el de log no guarda el número completo ni el texto", async () => {
    expect(await new NoSms().send("+51987654321", "x")).toEqual({ accepted: false, reason: "DISABLED" });
    const log = new LogSmsProvider();
    await log.send("+51987654321", "secreto");
    expect(log.sent).toEqual([{ to: "********4321", length: 7 }]);
  });
});

describe("regresión: ninguna API de IA o de pago fuera de los conectores", () => {
  it("el código de negocio no importa SDKs ni llama a hosts de IA, traducción o SMS", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = new URL("../src/", import.meta.url).pathname;
    const files: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith(".ts")) files.push(p); } };
    walk(root);
    const forbidden = /(@anthropic-ai|from "openai"|@google\/generative-ai|api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis|translation\.googleapis|api\.deepl\.com|api\.twilio\.com|sns\.amazonaws|api\.nvidia\.com|build\.nvidia\.com|openrouter\.ai)/;
    const offenders = files.filter((f) => !f.includes("/platform/connectors/") && forbidden.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { dependencies?: Record<string, string> };
    expect(Object.keys(pkg.dependencies ?? {}).filter((d) => /anthropic|openai|generative-ai|twilio|deepl|nvidia|openrouter/.test(d))).toEqual([]);
  });
});

describe("catálogo de capacidades y registro de uso (ADR 0110)", () => {
  class MemorySink { entries: AiCallEntry[] = []; async recordAiCall(e: AiCallEntry) { this.entries.push(e); } }

  it("ninguna capacidad es necesaria y todas tienen regla sin IA", () => {
    expect(AI_CAPABILITIES).toHaveLength(13);
    for (const c of AI_CAPABILITIES) {
      const info = AI_CAPABILITY_INFO[c];
      expect(info.required).toBe(false);
      expect(info.async).toBe(true);
      expect(info.deterministicFallback.length).toBeGreaterThan(10);
      expect(info.maxOutputTokens).toBeGreaterThan(0);
    }
    expect(AI_CAPABILITY_INFO.ANALYZE_IMAGE.never).toContain("identificar personas");
  });

  it("registra cada intento sin contenido, con estado, latencia, tokens y costo", async () => {
    const sink = new MemorySink();
    let clock = 1000;
    const p = new PaidFixture({ SUMMARIZE_INCIDENT: "resumen" }, 0.001);
    const core = new AiCore(p, new MemoryGuard(1), { timeoutMs: 1000, maxInputChars: 100 }, sink, () => (clock += 40));
    const eventId = "01a0ed4b-ae20-741a-a8d1-ad06459ad30d";
    const r = await core.run("SUMMARIZE_INCIDENT", "resume", "texto secreto ana@mail.com", { subject: { type: "EVENT", id: eventId }, actorUserId: null });
    expect(r.ok).toBe(true);
    expect(sink.entries).toHaveLength(1);
    const e = sink.entries[0]!;
    expect(e).toMatchObject({ capability: "SUMMARIZE_INCIDENT", provider: "paid-fixture", model: "fixture", status: "OK", fallback: false, latencyMs: 40, usd: 0.001, estimatedUsd: 0.001, subject: { type: "EVENT", id: eventId } });
    expect(e.inputTokens).toBeGreaterThan(0);
    expect(JSON.stringify(e)).not.toMatch(/secreto|ana@mail|resumen|resume/);
    // Tope de salida: nunca más que el de la capacidad.
    await core.run("SUMMARIZE_INCIDENT", "x", "y", { maxOutputTokens: 99_999 });
    expect(p.calls.at(-1)!.maxOutputTokens).toBe(AI_CAPABILITY_INFO.SUMMARIZE_INCIDENT.maxOutputTokens);
  });

  it("imagen y video: no disponibles hasta tener proveedor de visión; los fallos quedan como alternativa determinista", async () => {
    const sink = new MemorySink();
    const p = new PaidFixture({}, 0.001);
    const core = new AiCore(p, new MemoryGuard(0), undefined, sink);
    expect(await core.run("ANALYZE_IMAGE", "x", "y")).toEqual({ ok: false, reason: "UNSUPPORTED" });
    expect(await core.run("CLASSIFY_INCIDENT", "x", "y")).toEqual({ ok: false, reason: "NO_BUDGET" });
    expect(p.calls).toHaveLength(0);
    expect(sink.entries.map((e) => [e.status, e.fallback, e.usd])).toEqual([["UNSUPPORTED", true, 0], ["NO_BUDGET", true, 0]]);
  });

  it("con la IA apagada no escribe nada", async () => {
    const sink = new MemorySink();
    await new AiCore(new NoAIProvider(), new MemoryGuard(100), undefined, sink).run("MODERATE_CONTENT", "x", "y");
    expect(sink.entries).toHaveLength(0);
  });
});
