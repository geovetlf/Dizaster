import { afterAll, describe, expect, it } from "vitest";
import {
  AiCore, AiProviderError, AiRouter, checkPromptRegistry, FixtureAIProvider, PROMPTS, promptFingerprint, runEval, VERIFICATION_HINT,
  type AIProvider, type AiCallEntry, type EvalCase, type PromptTemplate,
} from "../src/platform/connectors/index.js";
import type { CostGuard } from "../src/platform/cost-guard.js";
import { AI_HINT_MAX_ATTEMPTS, parseHint } from "../src/modules/verification/index.js";
import { createTestContext, createUser, LIMA, reportBody, submit, type TestContext } from "./helpers.js";

// AI CORE resiliente (ADR 0280): 429, cortocircuito, prompts versionados, registro de modelos, evaluación y la cola
// asíncrona de pistas. Proveedores simulados en proceso; ninguna red.
const free: CostGuard = { check: async () => true, record: async () => undefined, isKilled: async () => false };
const sink = () => { const entries: AiCallEntry[] = []; return { entries, recordAiCall: async (e: AiCallEntry) => { entries.push(e); } }; };

/** Proveedor con guion: cada llamada toma el siguiente paso ("ok:<texto>", "429:<ms>", "error"). */
class Scripted implements AIProvider {
  readonly paid = false;
  calls = 0;
  constructor(readonly id: string, private readonly steps: string[], private readonly model = "fixture") {}
  estimateUsd() { return 0; }
  async complete() {
    const step = this.steps[Math.min(this.calls++, this.steps.length - 1)]!;
    if (step.startsWith("429:")) throw new AiProviderError("RATE_LIMITED", "429", Number(step.slice(4)));
    if (step === "error") throw new Error("500");
    return { text: step.slice(3), usage: { inputTokens: 1, outputTokens: 1 }, costUsd: 0, model: this.model };
  }
}

describe("prompts versionados", () => {
  it("cada prompt del registro coincide con su huella", () => {
    expect(checkPromptRegistry()).toEqual([]);
    expect(PROMPTS.length).toBeGreaterThan(0);
  });
  it("cambiar el texto sin nueva versión se detecta", () => {
    const edited: PromptTemplate = { ...VERIFICATION_HINT, text: `${VERIFICATION_HINT.text} Sé creativo.` };
    expect(checkPromptRegistry([edited]).join()).toMatch(/sube la versión/);
    expect(checkPromptRegistry([VERIFICATION_HINT, VERIFICATION_HINT]).join()).toMatch(/repetido/);
    expect(promptFingerprint("a")).toHaveLength(64);
  });
  it("ningún prompt pide a la IA confirmar oficialmente ni declarar falso", () => {
    for (const p of PROMPTS) expect(p.text).not.toMatch(/"OFFICIALLY_CONFIRMED"\s*\|/);
    expect(VERIFICATION_HINT.text).toMatch(/Nunca sugieras OFFICIALLY_CONFIRMED ni FALSE/);
  });
  it("el registro de llamadas guarda id y versión del prompt; una plantilla de otra capacidad no llama a nadie", async () => {
    const p = new Scripted("fixture", ['ok:{"suggestedLevel":null,"rationale":"x"}']);
    const s = sink();
    const core = new AiCore(AiRouter.single(p), free, { timeoutMs: 1000, maxInputChars: 100 }, s);
    expect((await core.run("ANALYZE_REPORT", VERIFICATION_HINT, "{}")).ok).toBe(true);
    expect(s.entries[0]).toMatchObject({ promptId: "verification-hint", promptVersion: 1 });
    expect(await core.run("SUMMARIZE_INCIDENT", VERIFICATION_HINT, "{}")).toEqual({ ok: false, reason: "UNSUPPORTED" });
    expect(p.calls).toBe(1);
  });
});

describe("límite de tasa y cortocircuito", () => {
  it("un 429 respeta la espera del proveedor y la ruta sigue con el siguiente", async () => {
    let now = 0;
    const a = new Scripted("a", ["429:10000", "ok:A"]);
    const b = new Scripted("b", ["ok:B"]);
    const s = sink();
    const core = new AiCore(new AiRouter([a, b], {}, ["a", "b"]), free, { timeoutMs: 1000, maxInputChars: 100 }, s, () => now);
    expect(await core.run("SUMMARIZE_INCIDENT", "x", "y")).toMatchObject({ ok: true, text: "B" });
    expect(s.entries.map((e) => e.status)).toEqual(["RATE_LIMITED", "OK"]);
    now = 5000;
    expect(await core.run("SUMMARIZE_INCIDENT", "x", "y")).toMatchObject({ ok: true, text: "B" });
    expect(a.calls).toBe(1);
    expect(s.entries.at(-2)!.status).toBe("CIRCUIT_OPEN");
    now = 20_000;
    expect(await core.run("SUMMARIZE_INCIDENT", "x", "y")).toMatchObject({ ok: true, text: "A" });
  });
  it("tres fallos seguidos abren el cortocircuito; al vencer, una prueba lo cierra", async () => {
    let now = 0;
    const a = new Scripted("a", ["error", "error", "error", "ok:vuelve"]);
    const core = new AiCore(AiRouter.single(a), free, { timeoutMs: 1000, maxInputChars: 100, breaker: { threshold: 3, cooldownMs: 1000, maxCooldownMs: 8000 } }, null, () => now);
    for (let i = 0; i < 3; i++) expect(await core.run("SUMMARIZE_INCIDENT", "x", "y")).toEqual({ ok: false, reason: "ERROR" });
    expect(await core.run("SUMMARIZE_INCIDENT", "x", "y")).toEqual({ ok: false, reason: "CIRCUIT_OPEN" });
    expect(a.calls).toBe(3);
    now = 1500;
    expect(await core.run("SUMMARIZE_INCIDENT", "x", "y")).toMatchObject({ ok: true, text: "vuelve" });
  });
  it("nunca lanza, aunque el proveedor falle de todas las formas", async () => {
    const core = new AiCore(AiRouter.single(new Scripted("a", ["429:0", "error"])), free, { timeoutMs: 10, maxInputChars: 10 });
    for (let i = 0; i < 5; i++) await expect(core.run("SUMMARIZE_INCIDENT", "x", "y")).resolves.toMatchObject({ ok: false });
  });
});

describe("registro de modelos", () => {
  it("con el registro exigido, un modelo no declarado no se usa", async () => {
    const core = (model: string) => new AiCore(AiRouter.single(new Scripted("fixture", ["ok:x"], model)), free, { timeoutMs: 100, maxInputChars: 10, enforceModelRegistry: true });
    expect(await (core("fixture")).run("SUMMARIZE_INCIDENT", "x", "y")).toMatchObject({ ok: true });
    expect(await (core("otro-modelo")).run("SUMMARIZE_INCIDENT", "x", "y")).toEqual({ ok: false, reason: "UNREGISTERED_MODEL" });
    expect(await (core("fixture")).run("ANALYZE_IMAGE", "x", "y")).toMatchObject({ ok: false });
  });
});

describe("evaluación determinística", () => {
  const cases: EvalCase[] = [
    { name: "pocos datos", input: '{"evidence":{}}', expect: { fields: { suggestedLevel: ["UNVERIFIED", "COMMUNITY_CORROBORATED", "EXTERNALLY_CORROBORATED", null], rationale: "string" }, forbidden: ["OFFICIALLY_CONFIRMED", "FALSE"], maxChars: 400 } },
  ];
  const evalWith = async (answer: string) => runEval(new AiCore(AiRouter.single(new FixtureAIProvider({ ANALYZE_REPORT: answer })), free, { timeoutMs: 100, maxInputChars: 1000 }), VERIFICATION_HINT, cases);
  it("una respuesta correcta pasa", async () => {
    expect(await evalWith('{"suggestedLevel":null,"rationale":"Faltan datos"}')).toMatchObject({ passed: 1, failed: 0 });
  });
  it("detecta confirmaciones prohibidas, JSON roto y campos fuera de la lista", async () => {
    for (const bad of ['{"suggestedLevel":"OFFICIALLY_CONFIRMED","rationale":"x"}', "claro que sí", '{"suggestedLevel":"MUY_ALTO","rationale":"x"}', '{"suggestedLevel":null}']) {
      expect((await evalWith(bad)).failed).toBe(1);
    }
  });
  it("sin IA la evaluación dice por qué no hubo respuesta", async () => {
    const r = await runEval(new AiCore(new AiRouter([]), free), VERIFICATION_HINT, cases);
    expect(r.results[0]).toMatchObject({ ok: false, status: "DISABLED" });
  });
  it("el parser de la pista descarta todo lo que no sea una sugerencia permitida", () => {
    expect(parseHint('{"suggestedLevel":"COMMUNITY_CORROBORATED","rationale":"3 reportes cercanos"}')).toMatchObject({ suggestedLevel: "COMMUNITY_CORROBORATED" });
    expect(parseHint('{"suggestedLevel":"OFFICIALLY_CONFIRMED","rationale":"x"}')).toBeNull();
    expect(parseHint('{"suggestedLevel":"FALSE","rationale":"x"}')).toBeNull();
    expect(parseHint("[]")).toBeNull();
    expect(parseHint(`{"suggestedLevel":null,"rationale":"${"a".repeat(500)}"}`)!.rationale).toHaveLength(280);
  });
});

describe("pistas de IA asíncronas: el reporte nunca depende de la IA", () => {
  let t: TestContext;
  afterAll(() => t?.close());

  const setup = async (provider: AIProvider | null) => {
    await t?.close();
    t = await createTestContext(provider ? { env: { AI_ROUTES: `ANALYZE_REPORT=${provider.id}` }, overrides: { connectors: { ai: provider } } } : {});
    await aiOn();
    const u = await createUser(t, "pista");
    const r = await submit(t, u, reportBody(u, { pin: LIMA, text: "Incendio en un almacén" }));
    expect(r.status).toBe(200);
    await t.c.dispatcher.runOnce(100);
    return r.body.eventId as string;
  };
  // La IA nace con su kill switch encendido (ADR 0019): estas pruebas lo apagan para ver la cola en marcha.
  const aiOn = () => t.c.db.query(`UPDATE cost.kill_switches SET killed = false WHERE feature = 'ai'`);
  const job = async (eventId: string) => (await t.c.db.query<{ status: string; attempts: number; last_reason: string | null }>(`SELECT status, attempts, last_reason FROM verification.ai_jobs WHERE event_id = $1`, [eventId])).rows[0];
  const suggestions = async () => (await t.c.db.query<{ suggested_level: string | null; prompt: string | null; task: string }>(`SELECT suggested_level, prompt, task FROM verification.ai_suggestions`)).rows;
  const level = async (eventId: string) => (await t.c.db.query<{ level: string }>(`SELECT level FROM verification.state WHERE event_id = $1`, [eventId])).rows[0]?.level;

  it("con rutas configuradas pero el kill switch de fábrica, la pista falla sin llamar al proveedor", async () => {
    const p = new Scripted("fixture", ['ok:{"suggestedLevel":null,"rationale":"x"}']);
    await t?.close();
    t = await createTestContext({ env: { AI_ROUTES: "ANALYZE_REPORT=fixture" }, overrides: { connectors: { ai: p } } });
    const u = await createUser(t, "apagada");
    const r = await submit(t, u, reportBody(u, { pin: LIMA, text: "Humo en el cerro" }));
    expect(r.status).toBe(200);
    await t.c.dispatcher.runOnce(100);
    await t.c.verification.processAiHints();
    expect(await job(r.body.eventId as string)).toMatchObject({ status: "FAILED", last_reason: "KILLED" });
    expect(p.calls).toBe(0);
  });

  it("IA apagada: no se encola nada ni se llama a nadie", async () => {
    const eventId = await setup(null);
    expect(await job(eventId)).toBeUndefined();
    expect(await t.c.verification.processAiHints()).toEqual({ done: 0, retry: 0, failed: 0 });
  });

  it("respuesta válida: queda como sugerencia con su prompt y el estado por reglas no cambia", async () => {
    const eventId = await setup(new Scripted("fixture", ['ok:{"suggestedLevel":"COMMUNITY_CORROBORATED","rationale":"Varios reportes cercanos"}']));
    const before = await level(eventId);
    expect(await job(eventId)).toMatchObject({ status: "PENDING" });
    expect(await t.c.verification.processAiHints()).toEqual({ done: 1, retry: 0, failed: 0 });
    expect(await suggestions()).toEqual([{ suggested_level: "COMMUNITY_CORROBORATED", prompt: "verification-hint@1", task: "verification-hint" }]);
    expect(await level(eventId)).toBe(before);
  });

  it("429 y errores se reintentan hasta el máximo y luego quedan fallidos, sin lanzar", async () => {
    const eventId = await setup(new Scripted("fixture", ["429:0", "error", "error", "error"]));
    for (let i = 0; i < AI_HINT_MAX_ATTEMPTS; i++) await t.c.verification.processAiHints();
    expect(await job(eventId)).toMatchObject({ status: "FAILED", attempts: AI_HINT_MAX_ATTEMPTS });
    expect(await suggestions()).toEqual([]);
  });

  it("una IA que intenta confirmar oficialmente se descarta", async () => {
    const eventId = await setup(new Scripted("fixture", ['ok:{"suggestedLevel":"OFFICIALLY_CONFIRMED","rationale":"seguro"}']));
    await t.c.verification.processAiHints();
    expect(await job(eventId)).toMatchObject({ status: "FAILED", last_reason: "INVALID_OUTPUT" });
    expect(await suggestions()).toEqual([]);
  });

  it("proveedor colgado: el reporte ya se guardó y la pista vence por tiempo", async () => {
    const hang = new FixtureAIProvider(); hang.behaviour = "hang";
    await t?.close();
    t = await createTestContext({ env: { AI_ROUTES: "ANALYZE_REPORT=fixture", AI_TIMEOUT_MS: "1000" }, overrides: { connectors: { ai: hang } } });
    await aiOn();
    const u = await createUser(t, "colgado");
    const r = await submit(t, u, reportBody(u, { pin: LIMA, text: "Inundación en la avenida" }));
    expect(r.status).toBe(200);
    await t.c.dispatcher.runOnce(100);
    expect(await t.c.verification.processAiHints()).toEqual({ done: 0, retry: 1, failed: 0 });
    const calls = (await t.c.db.query<{ status: string }>(`SELECT status FROM cost.ai_calls`)).rows.map((x) => x.status);
    expect(calls).toEqual(["TIMEOUT"]);
  });
});
