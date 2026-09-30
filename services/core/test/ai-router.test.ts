import { afterAll, describe, expect, it } from "vitest";
import {
  AI_CAPABILITIES, AI_CAPABILITY_INFO, AiCore, AiRouter, canonicalCapability, FixtureAIProvider, parseAiRoutes, buildConnectors,
  type AIProvider, type AiCallEntry, type ConnectorConfig,
} from "../src/platform/connectors/index.js";
import type { CostGuard } from "../src/platform/cost-guard.js";
import { createTestContext, createUser, LIMA, reportBody, submit, type TestContext } from "./helpers.js";

// AI ROUTER (ADR 0217): DIZASTER → AI CORE → AI ROUTER → PROVIDER ADAPTER → MODELO. Todo apagado por defecto.
class Guard implements CostGuard {
  spent = 0;
  constructor(public budget = 0) {}
  async check(_k: string, usd: number) { return this.spent + usd <= this.budget; }
  async record(_k: string, usd: number) { this.spent += usd; }
  async isKilled() { return false; }
}
class Named implements AIProvider {
  readonly calls: string[] = [];
  behaviour: "ok" | "fail" = "ok";
  constructor(readonly id: string, private readonly answers: Record<string, string> = {}, private readonly price = 0, readonly capabilities?: AIProvider["capabilities"]) {}
  get paid() { return this.price > 0; }
  estimateUsd() { return this.price; }
  async complete(req: Parameters<AIProvider["complete"]>[0]) {
    this.calls.push(req.capability);
    if (this.behaviour === "fail") throw new Error("caído");
    return { text: this.answers[req.capability] ?? "{}", usage: { inputTokens: 1, outputTokens: 1 }, costUsd: this.price, model: this.id };
  }
}
const sink = () => { const entries: AiCallEntry[] = []; return { entries, recordAiCall: async (e: AiCallEntry) => { entries.push(e); } }; };

describe("catálogo (ADR 0217)", () => {
  it("las 13 capacidades pedidas, ninguna obligatoria, todas con alternativa determinista", () => {
    expect([...AI_CAPABILITIES].sort()).toEqual([
      "ANALYZE_IMAGE", "ANALYZE_REPORT", "ANALYZE_VIDEO", "CLASSIFY_INCIDENT", "DETECT_DUPLICATE", "EXTRACT_INCIDENT_DATA", "GENERATE_EMBEDDING",
      "MODERATE_CONTENT", "MULTIMODAL_REASONING", "OPERATIONAL_SUMMARY", "SAFETY_CLASSIFICATION", "SUMMARIZE_INCIDENT", "TRANSLATE_TEXT",
    ]);
    for (const c of AI_CAPABILITIES) {
      expect(AI_CAPABILITY_INFO[c].required).toBe(false);
      expect(["YES", "PARTIAL"]).toContain(AI_CAPABILITY_INFO[c].canBeDeterministic);
    }
  });
  it("los nombres anteriores se siguen entendiendo", () => {
    expect(canonicalCapability("summarize")).toBe("SUMMARIZE_INCIDENT");
    expect(canonicalCapability("DETECT_SIMILARITY")).toBe("DETECT_DUPLICATE");
    expect(canonicalCapability("NOPE")).toBeNull();
  });
});

describe("router", () => {
  it("rutas por capacidad con cadena por defecto; errores de configuración al arrancar", () => {
    expect(parseAiRoutes("CLASSIFY_INCIDENT=a,b; summarize=c ;*=d")).toEqual({ routes: { CLASSIFY_INCIDENT: ["a", "b"], SUMMARIZE_INCIDENT: ["c"] }, defaultChain: ["d"] });
    expect(parseAiRoutes("")).toEqual({ routes: {}, defaultChain: null });
    expect(() => parseAiRoutes("MAGIC=a")).toThrow(/capacidad desconocida/);
    expect(() => new AiRouter([new Named("a")], { CLASSIFY_INCIDENT: ["zz"] })).toThrow(/proveedor desconocido/);
  });

  it("si el primero falla prueba el siguiente; cada intento queda registrado", async () => {
    const a = new Named("a"); a.behaviour = "fail";
    const b = new Named("b", { CLASSIFY_INCIDENT: "fire" });
    const s = sink();
    const core = new AiCore(new AiRouter([a, b], { CLASSIFY_INCIDENT: ["a", "b"] }), new Guard(), undefined, s);
    expect(await core.run("CLASSIFY_INCIDENT", "x", "y")).toMatchObject({ ok: true, text: "fire", provider: "b" });
    expect(s.entries.map((e) => [e.provider, e.status])).toEqual([["a", "ERROR"], ["b", "OK"]]);
    // Capacidades sin ruta: apagadas.
    expect(await core.run("SUMMARIZE_INCIDENT", "x", "y")).toEqual({ ok: false, reason: "DISABLED" });
    expect(core.available("CLASSIFY_INCIDENT")).toBe(true);
    expect(core.providerId).toBe("a+b");
  });

  it("uno de pago sin presupuesto cede al gratuito", async () => {
    const paid = new Named("paid", { MODERATE_CONTENT: "caro" }, 0.5);
    const local = new Named("local", { MODERATE_CONTENT: "ok" });
    const core = new AiCore(new AiRouter([paid, local], {}, ["paid", "local"]), new Guard(0));
    expect(await core.run("MODERATE_CONTENT", "x", "y")).toMatchObject({ ok: true, provider: "local" });
    expect(paid.calls).toHaveLength(0);
  });

  it("imagen, embeddings y multimodal solo con un adaptador que los declare", async () => {
    const text = new Named("text");
    const vision = new Named("vision", { ANALYZE_IMAGE: "desc" }, 0, ["ANALYZE_IMAGE"]);
    const core = new AiCore(new AiRouter([text, vision], { ANALYZE_IMAGE: ["text", "vision"], GENERATE_EMBEDDING: ["text"] }), new Guard());
    expect(await core.run("ANALYZE_IMAGE", "x", "ref")).toMatchObject({ ok: true, provider: "vision" });
    expect(await core.run("GENERATE_EMBEDDING", "x", "y")).toEqual({ ok: false, reason: "UNSUPPORTED" });
    expect(text.calls).toHaveLength(0);
  });

  it("configuración: AI_ROUTES reparte adaptadores y el modo costo cero sigue rechazando los de pago", () => {
    const cfg: ConnectorConfig = { COST_MODE: "zero", AI_PROVIDER: "none", AI_ROUTES: "CLASSIFY_INCIDENT=fixture", AI_TIMEOUT_MS: 1000, TRANSLATION_PROVIDER: "none", SMS_PROVIDER: "none", STT_PROVIDER: "none", TTS_PROVIDER: "none" };
    const c = buildConnectors(cfg, new Guard());
    expect(c.ai.available("CLASSIFY_INCIDENT")).toBe(true);
    expect(c.ai.available("SUMMARIZE_INCIDENT")).toBe(false);
    expect(() => buildConnectors({ ...cfg, AI_ROUTES: "*=paid" }, new Guard(), { ai: [new Named("paid", {}, 1)] })).toThrow(/COST_MODE=zero/);
  });
});

describe("DIZASTER funciona sin IA (ADR 0217)", () => {
  let t: TestContext;
  afterAll(() => t?.close());

  for (const scenario of ["apagada, sin claves y con presupuesto 0", "encendida pero con el modelo caído"] as const) {
    it(`reportar, crear evento, verificar y ver el feed: ${scenario}`, async () => {
      await t?.close();
      const down = new FixtureAIProvider(); down.behaviour = "fail";
      t = await createTestContext(scenario.startsWith("apagada") ? {} : { env: { AI_ROUTES: "*=fixture" }, overrides: { connectors: { ai: down } } });
      const u = await createUser(t, "sin_ia");
      const r = await submit(t, u, reportBody(u, { pin: LIMA, text: "Incendio en un almacén" }));
      expect(r.status).toBe(200);
      const ev = (await t.app.inject({ url: `/v1/events/${r.body.eventId}` })).json() as { publicVerificationState: string };
      expect(ev.publicVerificationState).toBe("UNVERIFIED");
      expect((await t.app.inject({ url: "/v1/feed", headers: { authorization: `Bearer ${u.token}` } })).statusCode).toBe(200);
      const calls = (await t.c.db.query(`SELECT 1 FROM cost.ai_calls`)).rowCount;
      expect(calls).toBe(0);
    });
  }
});
