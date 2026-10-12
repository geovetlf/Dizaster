import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateProposal, type AgentProposal } from "../src/agent.js";
import type { AuditRecord } from "../src/audit.js";
import { verifyLog } from "../src/audit.js";
import { decide, type Action } from "../src/autonomy.js";
import { loadPolicy, type Outcome } from "../src/policy.js";
import type { ReleaseRecord } from "../src/releases.js";
import { localEnv } from "./cli-env.js";

// Guardas que fallan cerrado, comprobación previa de autonomía, rollback y trazabilidad (ADR 0338). Sin nube ni red.
const root = new URL("../../../", import.meta.url).pathname;
const policy = loadPolicy(`${root}delivery/policy.json`);
const D = (n: number) => `sha256:${String(n).repeat(64).slice(0, 64)}`;
const cli = (args: string[], env: NodeJS.ProcessEnv = localEnv()) =>
  spawnSync(process.execPath, [`${root}tools/delivery/dist/cli.js`, ...args], { cwd: root, encoding: "utf8", env });
/** Copia de la política con otro nivel de autonomía (para probar niveles futuros sin tocar la versionada). */
const policyAt = (level: number): string => {
  const f = join(mkdtempSync(join(tmpdir(), "dzd-pol-")), "policy.json");
  writeFileSync(f, JSON.stringify({ ...policy, autonomyLevel: level }));
  return f;
};
const rel = (env: "staging" | "production", n: number, outcome: ReleaseRecord["outcome"]): ReleaseRecord =>
  ({ env, service: "api", revision: { name: `api-${n}`, digest: D(n) }, outcome, previous: null, at: `2026-10-0${n}T00:00:00Z`, actor: "human" });
const files = () => {
  const dir = mkdtempSync(join(tmpdir(), "dzd-g-"));
  return { dir, releases: join(dir, "rel.jsonl"), log: join(dir, "audit.jsonl") };
};
const cloud = ["--project", "p", "--region", "r", "--image", "r/p/dizaster/core"];

describe("la autonomía falla cerrado", () => {
  it("un nivel que no es entero 0–5 nunca permite (NaN < 4 es falso)", () => {
    for (const level of [Number.NaN, 4.5, -1, 6, Infinity]) {
      expect(decide(level, "deploy-staging").allowed, String(level)).toBe(false);
    }
  });

  it("un resultado de política desconocido no cuenta como auto", () => {
    expect(decide(5, "promote-production", "aproval" as Outcome)).toMatchObject({ allowed: false, needs: "forbidden" });
    expect(decide(5, "promote-production", "auto").allowed).toBe(true);
  });

  it("una acción desconocida no se permite", () => {
    expect(decide(5, "deploy-everything" as Action).allowed).toBe(false);
  });

  it("`dzd autonomy` con --level inválido sale con 3", () => {
    const r = cli(["autonomy", "--action", "promote-production", "--level", "abc"]);
    expect(r.status).toBe(3);
    expect(r.stdout).toContain("nivel de autonomía inválido");
  });
});

describe("promoción: el resultado de la política no se da por bueno", () => {
  it("sin --outcome, la automatización no promueve ni en nivel 5 (cuenta approval)", () => {
    const f = files();
    writeFileSync(f.releases, `${JSON.stringify(rel("staging", 1, "deployed"))}\n`);
    const r = cli(["promote", "--digest", D(1), "--actor", "agent:rules", "--policy", policyAt(5), "--releases", f.releases, "--log", f.log, ...cloud]);
    expect(r.status).toBe(3);
    expect(r.stderr).toContain("aprueba el propietario");
  });

  it("un --outcome desconocido se rechaza antes de decidir", () => {
    const f = files();
    writeFileSync(f.releases, `${JSON.stringify(rel("staging", 1, "deployed"))}\n`);
    const r = cli(["promote", "--digest", D(1), "--actor", "agent:rules", "--outcome", "aproval", "--policy", policyAt(5), "--releases", f.releases, "--log", f.log, ...cloud]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("--outcome");
  });

  it("un cambio de bajo riesgo en nivel 5 avanza, pero sin saltarse staging verificado ni la firma", () => {
    const f = files();
    // Sin staging verificado, no se promueve aunque la política diga auto.
    const none = cli(["promote", "--digest", D(2), "--actor", "agent:rules", "--outcome", "auto", "--policy", policyAt(5), "--releases", f.releases, "--log", f.log, ...cloud]);
    expect(none.status).toBe(1);
    expect(none.stderr).toContain("ya desplegado y verificado en staging");
    // Con staging verificado: pasa la autonomía y aun así exige la firma keyless de CI (en seco se imprime cosign).
    writeFileSync(f.releases, `${JSON.stringify(rel("staging", 2, "deployed"))}\n`);
    const ok = cli(["promote", "--digest", D(2), "--actor", "agent:rules", "--outcome", "auto", "--policy", policyAt(5), "--releases", f.releases, "--log", f.log, ...cloud]);
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stdout).toMatch(/\[en seco\] cosign verify .*--certificate-identity-regexp/);
    expect(ok.stdout).toContain(`r/p/dizaster/core@${D(2)}`);
  });

  it("el ejecutor del agente pone el resultado de la política del repositorio en deploy y promote", () => {
    const p: AgentProposal = { agent: "rules", steps: [{ command: "promote", flags: { digest: D(3) }, why: "x" }] };
    const [step] = validateProposal(p, { ...policy, autonomyLevel: 5 }, "approval", true);
    expect(step!.argv).toEqual(expect.arrayContaining(["--outcome", "approval"]));
    expect(step!.allowed).toBe(false);
    expect(step!.argv).not.toContain("--execute");
    const [low] = validateProposal(p, { ...policy, autonomyLevel: 5 }, "auto", true);
    expect(low!.argv).toEqual(expect.arrayContaining(["--outcome", "auto", "--execute"]));
  });
});

describe("`dzd guard`: autonomía antes de cualquier efecto", () => {
  const ci = { ...localEnv(), GITHUB_ACTIONS: "true" };

  it("en CI, con el nivel vigente (2), un actor que no es owner no migra staging; el owner sí", () => {
    const bot = cli(["guard", "--action", "migrate-staging", "--actor", "github:claude[bot]"], ci);
    expect(bot.status).toBe(3);
    expect(bot.stderr).toContain("requiere nivel 4");
    const owner = cli(["guard", "--action", "migrate-staging", "--actor", "github:geovetlf"], ci);
    expect(owner.status, owner.stderr).toBe(0);
  });

  it("migrar producción es del propietario en cualquier nivel", () => {
    const r = cli(["guard", "--action", "migrate-production", "--actor", "agent:rules", "--policy", policyAt(5)], ci);
    expect(r.status).toBe(3);
    expect(r.stderr).toContain("propietario");
  });

  it("en CI nadie es `human` a secas, no admite --level y exige --actor y una acción conocida", () => {
    expect(cli(["guard", "--action", "deploy-staging", "--actor", "human"], ci).status).toBe(3);
    expect(cli(["guard", "--action", "deploy-staging", "--actor", "agent:x", "--level", "5"], ci).status).toBe(1);
    expect(cli(["guard", "--action", "deploy-staging"], ci).status).toBe(1);
    expect(cli(["guard", "--action", "todo", "--actor", "github:geovetlf"], ci).status).toBe(1);
  });
});

describe("rollback por CLI y trazabilidad", () => {
  const history = [rel("staging", 1, "deployed"), rel("staging", 2, "deployed")];

  it("en seco: vuelve a la versión anterior servida, por revisión, y lo registra con commit y ejecución", () => {
    const f = files();
    writeFileSync(f.releases, `${history.map((h) => JSON.stringify(h)).join("\n")}\n`);
    const env = { ...localEnv(), GITHUB_SHA: "a".repeat(40), GITHUB_RUN_ID: "123", GITHUB_REF: "refs/heads/main" };
    const r = cli(["rollback", "--env", "staging", "--releases", f.releases, "--log", f.log, ...cloud], env);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("[en seco] gcloud run services update-traffic api --to-revisions=api-1=100");
    expect(r.stdout).toContain(`api-1 (${D(1).slice(0, 19)}`);
    const releases = readFileSync(f.releases, "utf8").trim().split("\n").map((l) => JSON.parse(l) as ReleaseRecord);
    expect(releases.at(-1)).toMatchObject({ outcome: "dry-run", revision: { digest: D(1) }, previous: { digest: D(2) } });
    const audit = readFileSync(f.log, "utf8").trim().split("\n").map((l) => JSON.parse(l) as AuditRecord);
    expect(audit.at(-1)).toMatchObject({ action: "rollback", environment: "staging", artifactDigest: D(1), commit: "a".repeat(40), runId: "123", ref: "refs/heads/main" });
    expect(verifyLog(audit).ok).toBe(true);
  });

  it("un digest que no se desplegó en ese entorno no es destino de rollback; sin historial tampoco hay rollback", () => {
    const f = files();
    writeFileSync(f.releases, `${history.map((h) => JSON.stringify(h)).join("\n")}\n`);
    const r = cli(["rollback", "--env", "staging", "--to", D(7), "--releases", f.releases, "--log", f.log, ...cloud]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("no se desplegó en este entorno");
    const empty = files();
    expect(cli(["rollback", "--env", "staging", "--releases", empty.releases, "--log", empty.log, ...cloud]).stderr).toContain("No hay versión anterior");
  });

  it("la automatización no hace rollback de producción por debajo del nivel 5", () => {
    const f = files();
    writeFileSync(f.releases, `${[rel("production", 1, "deployed"), rel("production", 2, "deployed")].map((h) => JSON.stringify(h)).join("\n")}\n`);
    const r = cli(["rollback", "--env", "production", "--actor", "agent:rules", "--releases", f.releases, "--log", f.log, ...cloud]);
    expect(r.status).toBe(3);
  });

  it("deploy en seco deja en la auditoría el digest, el commit y la ejecución de CI", () => {
    const f = files();
    const env = { ...localEnv(), GITHUB_SHA: "b".repeat(40), GITHUB_RUN_ID: "77" };
    const r = cli(["deploy", "--env", "staging", "--digest", D(4), "--releases", f.releases, "--log", f.log, ...cloud], env);
    expect(r.status, r.stderr).toBe(0);
    const [rec] = readFileSync(f.log, "utf8").trim().split("\n").map((l) => JSON.parse(l) as AuditRecord);
    expect(rec).toMatchObject({ action: "deploy", artifactDigest: D(4), commit: "b".repeat(40), runId: "77", details: { dryRun: true } });
  });
});
