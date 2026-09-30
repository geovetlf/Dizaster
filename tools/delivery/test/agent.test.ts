import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RuleAgent, validateProposal, type AgentContext, type AgentProposal } from "../src/agent.js";
import type { Impact } from "../src/inspect.js";
import { loadPolicy, type Policy } from "../src/policy.js";

// Delivery Agent opcional (ADR 0283): propone; el ejecutor valida; nada se salta un gate.
const root = new URL("../../../", import.meta.url).pathname;
const base = loadPolicy(`${root}delivery/policy.json`);
const at = (level: number): Policy => ({ ...base, autonomyLevel: level });
const D = `sha256:${"b".repeat(64)}`;
const areas = { backend: true, mobile: false, contracts: false, migrations: false, infra: false, ci: false, delivery: false, dependencies: false, docsOnly: false };
const impact = (risk: Impact["risk"], over: Partial<Impact["areas"]> = {}): Impact =>
  ({ files: [], packages: [], affectedPackages: [], coreModules: [], areas: { ...areas, ...over }, migrationFindings: [], risk, reasons: [], fullRegression: false });
const ctx = (over: Partial<AgentContext> = {}): AgentContext => ({ impact: impact("low"), policy: at(4), env: "staging", digest: D, ...over });
const cli = (args: string[]) => spawnSync(process.execPath, [`${root}tools/delivery/dist/cli.js`, ...args], { cwd: root, encoding: "utf8" });

describe("agente de reglas", () => {
  it("staging: política, gates, documentación, firma, despliegue y SLO, en ese orden", async () => {
    const p = await new RuleAgent().propose(ctx());
    expect(p.steps.map((s) => s.command)).toEqual(["policy", "run-gates", "docs", "signature-verify", "deploy", "verify"]);
    expect(p.stop).toBeUndefined();
  });

  it("después de un rollback o un rechazo solo diagnostica y se detiene", async () => {
    for (const lastOutcome of ["rolled-back", "rejected"] as const) {
      const p = await new RuleAgent().propose(ctx({ lastOutcome }));
      expect(p.steps.map((s) => s.command)).toEqual(["diagnose"]);
      expect(p.stop?.needs).toBe("human");
    }
  });

  it("sin imagen o con solo documentación no propone desplegar", async () => {
    expect((await new RuleAgent().propose(ctx({ digest: undefined }))).stop?.reason).toMatch(/no hay imagen/);
    const docs = await new RuleAgent().propose(ctx({ impact: impact("low", { backend: false, docsOnly: true }) }));
    expect(docs.steps.some((s) => s.command === "deploy")).toBe(false);
    expect(docs.stop?.reason).toMatch(/solo documentación/);
  });

  it("infraestructura cambiada: agrega la revisión de IAM", async () => {
    const p = await new RuleAgent().propose(ctx({ impact: impact("medium", { infra: true }) }));
    expect(p.steps.map((s) => s.command)).toContain("iac-check");
  });

  it("producción: promueve el mismo digest y se detiene si la política pide al propietario", async () => {
    const p = await new RuleAgent().propose(ctx({ env: "production", impact: impact("critical") }));
    expect(p.steps.at(-1)).toMatchObject({ command: "promote", flags: { digest: D } });
    expect(p.stop?.needs).toBe("owner-approval");
  });
});

describe("ejecutor: el agente no se salta nada", () => {
  it("con el nivel vigente (2) el despliegue queda denegado y lo que sigue también", async () => {
    const p = await new RuleAgent().propose(ctx({ policy: at(2) }));
    const v = validateProposal(p, at(2), "auto", true);
    const deploy = v.find((x) => x.step.command === "deploy")!;
    expect(deploy.allowed).toBe(false);
    expect(deploy.reason).toMatch(/nivel 4/);
    expect(v.at(-1)!.reason).toMatch(/paso anterior/);
    expect(v.flatMap((x) => x.argv)).not.toContain("--execute");
  });

  it("con nivel 4 despliega staging con --execute, pero promover a producción nunca en nivel 4", async () => {
    const v = validateProposal(await new RuleAgent().propose(ctx()), at(4), "auto", true);
    expect(v.find((x) => x.step.command === "deploy")!.argv).toContain("--execute");
    const prod = validateProposal(await new RuleAgent().propose(ctx({ env: "production" })), at(4), "auto", true);
    expect(prod.find((x) => x.step.command === "promote")!.allowed).toBe(false);
  });

  it("sin --execute nunca agrega --execute, aunque la autonomía lo permita", async () => {
    const v = validateProposal(await new RuleAgent().propose(ctx()), at(5), "auto", false);
    expect(v.flatMap((x) => x.argv)).not.toContain("--execute");
  });

  it("la identidad es siempre agent:<nombre>; el agente no puede declararse humano ni traer su política", () => {
    const bad: AgentProposal = { agent: "x1", steps: [{ command: "deploy", flags: { env: "staging", digest: D, actor: "human" }, why: "" }] };
    expect(validateProposal(bad, at(5), "auto", true)[0]).toMatchObject({ allowed: false, reason: expect.stringMatching(/banderas no permitidas: actor/) });
    for (const flag of ["policy", "execute", "image", "project", "key"]) {
      const p: AgentProposal = { agent: "x1", steps: [{ command: "deploy", flags: { env: "staging", [flag]: "v" }, why: "" }] };
      expect(validateProposal(p, at(5), "auto", true)[0]!.allowed).toBe(false);
    }
    const ok = validateProposal({ agent: "x1", steps: [{ command: "docs", flags: {}, why: "" }] }, at(5), "auto", false)[0]!;
    expect(ok.argv.slice(-2)).toEqual(["--actor", "agent:x1"]);
  });

  it("rechaza comandos fuera de la lista, valores que parecen banderas y nombres de agente raros", () => {
    const unknown = { agent: "x1", steps: [{ command: "destroy" as "docs", flags: {}, why: "" }] };
    expect(validateProposal(unknown, at(5), "auto", true)[0]!.reason).toMatch(/fuera de la lista/);
    const sneaky = { agent: "x1", steps: [{ command: "deploy" as const, flags: { env: "staging", digest: "--execute" }, why: "" }] };
    expect(validateProposal(sneaky, at(5), "auto", true)[0]!.reason).toMatch(/valor inválido/);
    expect(() => validateProposal({ agent: "Human Owner", steps: [] }, at(5), "auto", true)).toThrow(/nombre/);
  });

  it("el dónde lo pone quien invoca: imagen y URL se inyectan solo en los comandos que las usan", async () => {
    const v = validateProposal(await new RuleAgent().propose(ctx()), at(4), "auto", false, { image: "reg/core", url: "https://api", project: "p", region: "r", files: "a.ts" });
    expect(v.find((x) => x.step.command === "deploy")!.argv).toEqual(expect.arrayContaining(["--image", "reg/core", "--url", "https://api", "--project", "p"]));
    expect(v.find((x) => x.step.command === "docs")!.argv).not.toContain("--image");
    expect(v.find((x) => x.step.command === "docs")!.argv).toEqual(expect.arrayContaining(["--files", "a.ts"]));
    expect(v.find((x) => x.step.command === "verify")!.argv).toEqual(expect.arrayContaining(["--url", "https://api"]));
  });

  it("política que bloquea o pide revisión: producción con revisión queda denegada", () => {
    const p: AgentProposal = { agent: "x1", steps: [{ command: "promote", flags: { digest: D }, why: "" }] };
    expect(validateProposal(p, at(5), "review", true)[0]!.allowed).toBe(false);
    expect(validateProposal(p, at(5), "block", true)[0]!.allowed).toBe(false);
  });
});

describe("CLI", () => {
  it("`dzd agent` muestra el plan y la denegación del nivel vigente", () => {
    const r = cli(["agent", "--env", "staging", "--digest", D, "--files", "services/core/src/server.ts"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/✗ dzd deploy .*requiere nivel 4/);
  });

  it("un comando llamado directamente con --actor agent:… también pasa por la autonomía", () => {
    const dir = mkdtempSync(join(tmpdir(), "dzd-agent-"));
    writeFileSync(join(dir, "r.jsonl"), "");
    const r = cli(["deploy", "--env", "staging", "--digest", D, "--image", "reg/core", "--project", "p", "--region", "r", "--actor", "agent:rules", "--releases", join(dir, "r.jsonl"), "--log", join(dir, "a.jsonl")]);
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/no permitido para agent:rules/);
  });

  it("`dzd agent run` con solo documentación corre sus pasos y se detiene sin desplegar", () => {
    const dir = mkdtempSync(join(tmpdir(), "dzd-agent-"));
    const r = cli(["agent", "run", "--env", "staging", "--files", "docs/runbooks/README.md", "--releases", join(dir, "r.jsonl"), "--log", join(dir, "a.jsonl")]);
    expect(r.stdout).toMatch(/▶ dzd policy/);
    expect(r.stdout).toMatch(/■ solo documentación/);
    expect(r.stdout).not.toMatch(/dzd deploy/);
    expect(r.status).toBe(0);
  });
});
