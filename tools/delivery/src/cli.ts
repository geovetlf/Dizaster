#!/usr/bin/env node
/**
 * dzd — Dizaster Delivery Control Plane (Blueprint §20, ADR 0260). Determinístico: sin IA, sin red salvo `verify`,
 * sin credenciales. GitHub Actions lo ejecuta; Claude y las personas también pueden ejecutarlo localmente.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { sha256File, verifyManifest, type ArtifactManifest } from "./artifact.js";
import { RuleAgent, validateProposal } from "./agent.js";
import { appendAudit, readLog, verifyLog, type Actor } from "./audit.js";
import { decide, isHuman, LEVELS, type Action } from "./autonomy.js";
import { CloudRunTarget, type Runner } from "./cloudrun.js";
import { costGate } from "./cost.js";
import { rollbackTo, rollout, type DeployTarget } from "./deploy.js";
import { diagnose } from "./diagnose.js";
import { checkEnvironment } from "./envcheck.js";
import { apiReadOf, checkGithubGuards, requiredChecksOf, verifiedSummary, type ApiRead } from "./github-guard.js";
import { checkDocs } from "./docs.js";
import { checkIamHcl, checkPlan, type TofuPlan } from "./iac.js";
import { runLoad } from "./load.js";
import { LocalDockerTarget, startProxy, waitHealthy } from "./local.js";
import { analyze, gitChanges, parseNameStatus, workspacePackages, type Change } from "./inspect.js";
import { loadPolicy, outcomeFor, type Environment, type Outcome } from "./policy.js";
import { planGates } from "./plan.js";
import { buildProvenance, contextFromEnv, verifyProvenance, type BuildContext, type Provenance } from "./provenance.js";
import { appendRelease, lastServing, promotable, readReleases, rollbackCandidate } from "./releases.js";
import { markdownReport } from "./report.js";
import { checkVerifyOutput, cosignVerifyArgs, cosignVerifyAttestationArgs } from "./signing.js";
import { evaluateSlo, fromK6Summary, fromSamples, type SloResult } from "./slo.js";
import { deliveryStats } from "./stats.js";
import { allOk, runChecks } from "./verify.js";

const [cmd, ...rest] = process.argv.slice(2);
const flags = new Map<string, string>();
for (let i = 0; i < rest.length; i++) {
  const a = rest[i]!;
  if (a.startsWith("--")) {
    const next = rest[i + 1];
    if (next !== undefined && !next.startsWith("--")) { flags.set(a.slice(2), next); i++; } else flags.set(a.slice(2), "true");
  }
}
const flag = (k: string, d?: string) => flags.get(k) ?? d;
const json = flags.has("json");
const out = (v: unknown, text: () => string) => console.log(json ? JSON.stringify(v, null, 2) : text());

function changes(): Change[] {
  if (flags.has("files")) return flag("files")!.split(",").filter(Boolean).map((path) => ({ path, status: "M" as const }));
  if (flags.has("worktree")) {
    const tracked = parseNameStatus(execFileSync("git", ["diff", "--name-status", "-M", "HEAD"], { encoding: "utf8" }));
    const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { encoding: "utf8" }).split("\n").filter(Boolean);
    return [...tracked, ...untracked.map((path) => ({ path, status: "A" as const }))];
  }
  // Primer push de una rama: GitHub da un "before" de ceros; se compara con el commit anterior.
  const base = flag("base", process.env["DZD_BASE"] || "HEAD~1")!;
  return gitChanges(/^0+$/.test(base) ? "HEAD~1" : base, flag("head", "HEAD"));
}

function impact() {
  const policy = loadPolicy(flag("policy"));
  const ch = changes();
  const read = (p: string) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };
  return { policy, changes: ch, impact: analyze(ch, policy, { pkgs: workspacePackages(), readFile: read, ref: flag("ref", process.env["GITHUB_REF"]) }) };
}

/**
 * Ejecución real de gcloud solo con `--execute` (y solo cuando existan los proyectos, D-18). Por defecto, en seco:
 * se imprime cada comando y no se toca la nube.
 */
function runner(): Runner {
  if (!flags.has("execute")) return async (c, args) => { console.log(`[en seco] ${c} ${args.join(" ")}`); return ""; };
  return async (c, args) => execFileSync(c, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

/** La automatización respeta el nivel de autonomía; una persona que ejecuta el comando decide por sí misma. */
function guard(action: Action, outcome: Outcome = "auto"): void {
  const actor = flag("actor", "human")!;
  if (isHuman(actor, loadPolicy(flag("policy")).owners, process.env)) return;
  const d = decide(loadPolicy(flag("policy")).autonomyLevel, action, outcome);
  if (!d.allowed) fail(`${action} no permitido para ${actor}: ${d.reason}`, 3);
}

const latestMigration = (): string | undefined => {
  try { return readdirSync("services/core/migrations").filter((f) => f.endsWith(".sql")).sort().at(-1); } catch { return undefined; }
};

function fail(msg: string, code = 1): never {
  console.error(msg);
  process.exit(code);
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

/**
 * Firma de la imagen (ADR 0277): en seco se imprime el comando; con `--execute` se ejecuta cosign y además se comprueba
 * que lo firmado sea exactamente este digest. `--key` (clave local) solo vale para el destino local de pruebas.
 */
function verifySignature(image: string, digest: string, env: string): void {
  const policy = loadPolicy(flag("policy"));
  const key = flag("key");
  if (key && env !== "local") fail("--key solo se admite con --env local: staging y production exigen firma keyless de CI.");
  let args: string[];
  try {
    args = cosignVerifyArgs(policy.signing, image, digest, key);
  } catch (e) {
    if (!flags.has("execute")) { console.log(`[en seco] firma: ${(e as Error).message}`); return; }
    fail(`Firma no verificable: ${(e as Error).message}`);
  }
  if (!flags.has("execute")) { console.log(`[en seco] cosign ${args.join(" ")}`); return; }
  const r = spawnSync(flag("cosign", "cosign")!, args, { encoding: "utf8" });
  if (r.status !== 0) fail(`Firma rechazada por cosign: ${(r.stderr ?? "").trim().split("\n").at(-1)}`);
  const problems = checkVerifyOutput(r.stdout ?? "", digest);
  if (problems.length) fail(`Firma rechazada: ${problems.join("; ")}`);
  console.log(`✓ firma verificada para ${digest.slice(0, 19)}…`);
}

/**
 * Destino según el entorno: `local` = Docker en esta máquina con el proxy de `dzd local-proxy` (ADR 0282); staging y
 * production = Cloud Run. El destino local no toca la nube ni exige firma keyless (con `--key` sí la verifica).
 */
function targetFor(env: string, service: string, needImage: boolean): DeployTarget {
  if (env === "local") {
    return new LocalDockerTarget({
      state: flag("state", ".dzd/local-state.json")!, image: flag("image", "")!, envFile: flag("env-file"),
      basePort: Number(flag("base-port", "18080")), waitHealthy: flags.has("execute") ? (u) => waitHealthy(u) : undefined,
    }, runner());
  }
  return new CloudRunTarget({
    project: flag("project") ?? fail("--project es obligatorio"), region: flag("region") ?? fail("--region es obligatorio"), service,
    image: needImage ? flag("image") ?? fail("--image es obligatorio (REGIÓN-docker.pkg.dev/PROYECTO/dizaster/core)") : flag("image", "")!,
  }, runner());
}

function printSlo(r: SloResult): void {
  out(r, () => r.findings.map((f) => `${f.ok ? "✓" : f.enforced ? "✗" : "·"} ${f.check}: ${f.detail}`).join("\n"));
}

switch (cmd) {
  case "inspect": {
    const { impact: im } = impact();
    out(im, () => [
      `Riesgo: ${im.risk}${im.reasons.length ? `\n  ${im.reasons.join("\n  ")}` : ""}`,
      `Paquetes: ${im.packages.join(", ") || "—"} (afectados: ${im.affectedPackages.join(", ") || "—"})`,
      `Módulos del core: ${im.coreModules.join(", ") || "—"}`,
      `Áreas: ${Object.entries(im.areas).filter(([, v]) => v).map(([k]) => k).join(", ") || "—"}`,
      `Regresión completa: ${im.fullRegression ? "sí" : "no"}`,
    ].join("\n"));
    break;
  }
  case "plan": {
    const gates = planGates(impact().impact);
    out(gates, () => gates.map((g) => `[${g.stage}] ${g.command}  # ${g.why}`).join("\n"));
    break;
  }
  case "policy": {
    const { policy, impact: im } = impact();
    const env = flag("env", "staging") as Environment;
    const outcome = outcomeFor(policy, im.risk, env);
    out({ env, risk: im.risk, outcome, reasons: im.reasons, migrationFindings: im.migrationFindings }, () =>
      `${env}: ${outcome} (riesgo ${im.risk})${im.reasons.length ? `\n  ${im.reasons.join("\n  ")}` : ""}`);
    if (outcome === "block") fail("La política bloquea este cambio (ADR 0262).");
    const required = flag("require") as Outcome | undefined;
    if (required && outcome !== required) fail(`Se requiere "${required}" y la política da "${outcome}".`, 2);
    break;
  }
  case "run-gates": {
    const gates = planGates(impact().impact);
    const byStage = [...new Set(gates.map((g) => g.stage))].sort();
    for (const s of byStage) {
      for (const g of gates.filter((x) => x.stage === s)) {
        console.log(`▶ ${g.command}`);
        // Los comandos salen de planGates (código versionado), nunca de entrada externa.
        // nosemgrep: no-shell-exec
        const r = spawnSync(g.command, { shell: true, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
        process.stdout.write(r.stdout ?? "");
        process.stderr.write(r.stderr ?? "");
        if (r.status !== 0) {
          const d = diagnose(`${r.stdout}\n${r.stderr}`);
          fail(`✗ ${g.id}: ${d.summary}${d.retryable ? " (reintentable una vez)" : ""}\n${d.hints.map((h) => `  ${h}`).join("\n")}`);
        }
      }
    }
    console.log("✓ todos los gates en verde");
    break;
  }
  case "autonomy": {
    const policy = loadPolicy(flag("policy"));
    const action = flag("action") as Action | undefined;
    if (!action) {
      out({ level: policy.autonomyLevel, name: LEVELS[policy.autonomyLevel] }, () => `Nivel vigente: ${policy.autonomyLevel} (${LEVELS[policy.autonomyLevel]})`);
      break;
    }
    const d = decide(Number(flag("level", String(policy.autonomyLevel))), action, flag("outcome", "auto") as Outcome);
    out(d, () => `${action}: ${d.allowed ? "permitido" : `no (${d.needs})`} — ${d.reason}`);
    if (!d.allowed) process.exit(3);
    break;
  }
  case "audit": {
    const log = flag("log", "delivery-audit.jsonl")!;
    if (rest[0] === "stats") {
      const st = deliveryStats(readLog(log));
      const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)} %`);
      out(st, () => [`Despliegues: ${st.deploys} (fallidos ${st.failedDeploys}, rollbacks ${st.rollbacks})`,
        `Tasa de fallos: ${pct(st.changeFailureRate)} · por semana: ${st.deploysPerWeek?.toFixed(1) ?? "—"} · recuperación (mediana): ${st.medianRecoveryMinutes?.toFixed(0) ?? "—"} min`].join("\n"));
    } else if (rest[0] === "verify") {
      const r = verifyLog(readLog(log));
      if (!r.ok) fail(`Auditoría alterada en la entrada ${r.index}: ${r.problem}`);
      console.log("auditoría íntegra");
    } else {
      const rec = appendAudit(log, {
        actor: (flag("actor", "delivery-plane") as Actor), action: flag("action", "unknown")!,
        environment: flag("env", "none") as "none", commit: flag("commit", process.env["GITHUB_SHA"]), ref: flag("ref", process.env["GITHUB_REF"]),
        runId: flag("run", process.env["GITHUB_RUN_ID"]), decision: flag("decision"), result: flag("result") as "ok" | undefined,
        artifactDigest: flag("digest"), reasons: flag("reasons")?.split("|"),
      });
      out(rec, () => `registrado ${rec.id} (${rec.hash.slice(0, 12)})`);
    }
    break;
  }
  case "artifact": {
    const file = flag("file") ?? fail("--file es obligatorio");
    if (rest[0] === "verify") {
      const m = JSON.parse(readFileSync(flag("manifest") ?? fail("--manifest es obligatorio"), "utf8")) as ArtifactManifest;
      const problems = verifyManifest(m, sha256File(file));
      if (problems.length) fail(`Artefacto rechazado:\n  ${problems.join("\n  ")}`);
      console.log(`artefacto verificado ${m.digest}`);
    } else {
      const m: ArtifactManifest = {
        name: flag("name", "artifact")!, version: flag("version", "0.0.0")!, commit: flag("commit", process.env["GITHUB_SHA"] ?? "")!,
        builtAt: new Date().toISOString(), digest: sha256File(file), imageDigest: flag("image-digest"), sbomDigest: flag("sbom") ? sha256File(flag("sbom")!) : undefined,
        buildEnv: { node: process.version, runner: process.env["RUNNER_OS"] }, tests: flag("tests", "skipped") as "passed", security: flag("security", "skipped") as "passed",
      };
      writeFileSync(flag("out", `${file}.manifest.json`)!, `${JSON.stringify(m, null, 2)}\n`);
      out(m, () => `manifiesto ${m.digest}`);
    }
    break;
  }
  case "verify": {
    const url = flag("url") ?? fail("--url es obligatorio");
    const rounds = Math.max(1, Number(flag("repeat", "1")));
    const all = [];
    for (let i = 0; i < rounds; i++) all.push(...(await runChecks(url)));
    const r = all.slice(-all.length / rounds);
    out(r, () => r.map((c) => `${c.ok ? "✓" : "✗"} ${c.name} (${c.ms} ms) ${c.ok ? "" : c.detail}`).join("\n"));
    if (!allOk(all)) process.exit(1);
    if (flags.has("slo")) {
      const s = evaluateSlo(fromSamples(all.map((c) => ({ ms: c.ms, status: c.status ?? 0 }))), loadPolicy(flag("policy")).slo, { smoke: true });
      printSlo(s);
      if (!s.ok) process.exit(1);
    }
    break;
  }
  case "iac-check": {
    const policy = loadPolicy(flag("policy"));
    const findings = [
      ...(flags.has("plan") ? checkPlan(JSON.parse(readFileSync(flag("plan")!, "utf8")) as TofuPlan, policy.cost) : []),
      ...(flag("hcl")?.split(",").flatMap((f) => checkIamHcl(readFileSync(f, "utf8"), f)) ?? []),
    ];
    out(findings, () => findings.map((f) => `${f.severity}: ${f.address} — ${f.message}`).join("\n") || "IaC sin hallazgos");
    if (findings.some((f) => f.severity === "block")) process.exit(1);
    if (findings.length) process.exit(2);
    break;
  }
  case "diagnose": {
    const d = diagnose(readFileSync(flag("log") ?? 0, "utf8"));
    out(d, () => `${d.kind}: ${d.summary}\n${d.hints.join("\n")}`);
    break;
  }
  case "docs": {
    const { policy, changes: ch } = impact();
    const missing = checkDocs(ch.map((c) => c.path), policy.docRules);
    out(missing, () => missing.join("\n") || "documentación al día");
    if (missing.length) process.exit(1);
    break;
  }
  case "report": {
    const { policy, impact: im } = impact();
    const md = markdownReport(im, planGates(im), { staging: outcomeFor(policy, im.risk, "staging"), production: outcomeFor(policy, im.risk, "production") });
    if (flag("out")) writeFileSync(flag("out")!, md);
    process.stdout.write(md);
    break;
  }
  case "cost": {
    const policy = loadPolicy(flag("policy"));
    const resource = flag("resource") ?? fail("--resource es obligatorio");
    const r = costGate(policy.cost, { [resource]: Number(flag("used", "0")) }, { resource, estimate: Number(flag("estimate", "0")) });
    out(r, () => `${r.allowed ? "✓" : "✗"} ${r.reason}`);
    if (!r.allowed) process.exit(1);
    break;
  }
  case "config-check": {
    // La validación es la del propio backend (loadEnv), en otro proceso: el Delivery Plane no importa el runtime.
    const file = flag("env-file") ?? fail("--env-file es obligatorio");
    const vars = Object.fromEntries(readFileSync(file, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
      .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
    // Un secreto se declara como `secret:<id>` (vive en Secret Manager): se comprueba que exista, no su valor.
    const env = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, v.startsWith("secret:") ? `placeholder-${"x".repeat(40)}` : v]));
    const r = spawnSync(process.execPath, [flag("checker", "services/core/dist/config-check-cli.js")!], { env: { PATH: process.env["PATH"], ...env }, encoding: "utf8" });
    process.stdout.write(r.stdout ?? "");
    if (r.status !== 0) fail(`Configuración rechazada: ${(r.stderr ?? "").trim()}`);
    break;
  }
  case "slo": {
    const policy = loadPolicy(flag("policy"));
    const obs = flag("k6") ? fromK6Summary(readJson(flag("k6")!)) : flag("samples") ? fromSamples(readJson(flag("samples")!)) : fail("--k6 o --samples es obligatorio");
    const r = evaluateSlo(obs, policy.slo, { smoke: flags.has("smoke") });
    printSlo(r);
    if (!r.ok) process.exit(1);
    break;
  }
  case "env-check": {
    const env = flag("env", "staging") as "staging" | "production";
    const read = (p?: string) => (p ? readFileSync(p, "utf8") : undefined);
    const envFile = read(flag("env-file"));
    const findings = checkEnvironment({
      env, mainTf: readFileSync(`infra/tofu/envs/${env}/main.tf`, "utf8"), tfvars: read(flag("tfvars")), otherTfvars: read(flag("other-tfvars")),
      runtimeEnv: envFile ? Object.fromEntries(envFile.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])) : undefined,
      repository: loadPolicy(flag("policy")).signing.repository,
    });
    out(findings, () => findings.map((x) => `${x.severity}: ${x.where} — ${x.message}`).join("\n") || `${env}: entorno completo`);
    if (findings.some((x) => x.severity === "block")) process.exit(1);
    break;
  }
  case "github-guard": {
    // Lecturas de la API tal como las dejó el workflow (ADR 0303 y 0306): `<archivo>` con el cuerpo o, si la llamada
    // falló, `<archivo>.err` con el mensaje de `gh`. Sin ninguno de los dos, la lectura cuenta como no verificable.
    const apiRead = (path: string): ApiRead => existsSync(`${path}.err`) ? apiReadOf({ error: readFileSync(`${path}.err`, "utf8") })
      : existsSync(path) ? apiReadOf({ body: readFileSync(path, "utf8") }) : { ok: false, missing: false, error: `sin lectura en ${path}` };
    const staging = flag("staging");
    const production = flag("production");
    const ref = flag("ref");
    const findings = checkGithubGuards({
      ...(ref ? { ref } : {}),
      branchRules: apiRead(flag("rules") ?? fail("--rules es obligatorio")),
      requiredChecks: requiredChecksOf(readJson(flag("ruleset", ".github/rulesets/main.json")!)),
      owners: loadPolicy(flag("policy")).owners,
      ...(staging ? { staging: apiRead(staging) } : {}),
      ...(production ? { production: apiRead(production) } : {}),
    });
    out(findings, () => findings.map((x) => `${x.severity} (${x.kind === "unverifiable" ? "no verificable" : "incorrecto"}): ${x.where} — ${x.message}`).join("\n")
      || verifiedSummary({ staging: !!staging, production: !!production }));
    if (findings.length) process.exit(1);
    break;
  }
  case "provenance": {
    const policy = loadPolicy(flag("policy"));
    if (rest[0] === "verify") {
      const p = readJson<Provenance>(flag("file") ?? fail("--file es obligatorio"));
      const problems = verifyProvenance(p, { digest: flag("digest") ?? fail("--digest es obligatorio"), commit: flag("commit"), repository: policy.signing.repository, workflows: policy.signing.workflows, refs: policy.signing.refs });
      if (problems.length) fail(`Procedencia rechazada:\n  ${problems.join("\n  ")}`);
      console.log("procedencia verificada");
      break;
    }
    const m = readJson<ArtifactManifest>(flag("manifest") ?? fail("--manifest es obligatorio"));
    const ctx: BuildContext | null = flag("repository")
      ? { repository: flag("repository")!, ref: flag("ref", "refs/heads/main")!, workflowPath: flag("workflow", ".github/workflows/ci.yml")!, runId: flag("run", "0")!, runAttempt: "1" }
      : contextFromEnv(process.env);
    if (!ctx) fail("Sin contexto de GitHub Actions: se da --repository (y opcionalmente --ref, --workflow, --run).");
    const prov = buildProvenance(m, flag("image") ?? fail("--image es obligatorio"), ctx);
    // cosign attest --type slsaprovenance1 espera solo el predicado.
    writeFileSync(flag("out", "provenance.json")!, `${JSON.stringify(flags.has("predicate") ? prov.predicate : prov, null, 2)}\n`);
    out(prov, () => `procedencia de ${m.imageDigest} escrita en ${flag("out", "provenance.json")}`);
    break;
  }
  case "signature": {
    if (rest[0] !== "verify") fail("uso: dzd signature verify --image REG/core --digest sha256:… [--execute] [--attestations]");
    const image = flag("image") ?? fail("--image es obligatorio");
    const digest = flag("digest") ?? fail("--digest es obligatorio");
    verifySignature(image, digest, flag("env", "staging")!);
    if (flags.has("attestations")) {
      const policy = loadPolicy(flag("policy"));
      for (const type of ["slsaprovenance1", "cyclonedx"] as const) {
        const args = cosignVerifyAttestationArgs(policy.signing, image, digest, type, flag("key"));
        if (!flags.has("execute")) { console.log(`[en seco] cosign ${args.join(" ")}`); continue; }
        const r = spawnSync(flag("cosign", "cosign")!, args, { encoding: "utf8" });
        if (r.status !== 0) fail(`Atestación ${type} rechazada: ${(r.stderr ?? "").trim().split("\n").at(-1)}`);
        console.log(`✓ atestación ${type}`);
      }
    }
    break;
  }
  case "deploy":
  case "promote": {
    const env = (cmd === "promote" ? "production" : flag("env", "staging")) as "staging" | "production" | "local";
    if (!["staging", "production", "local"].includes(env)) fail("--env: staging, production o local");
    const digest = flag("digest") ?? fail("--digest es obligatorio");
    const service = flag("service", "api")!;
    const releases = flag("releases", "delivery-releases.jsonl")!;
    const history = readReleases(releases);
    if (env === "production" && !promotable(history, service, digest)) fail("Solo se promueve a producción un digest ya desplegado y verificado en staging (§20.13).");
    if (env === "local") {
      // Ensayo en esta máquina: sin nube ni autonomía que decidir; la firma se verifica si se da una clave local.
      if (flag("key")) verifySignature(flag("image") ?? fail("--image es obligatorio con --key"), digest, env);
      else console.log("local: firma no exigida (staging y production sí la exigen)");
    } else {
      guard(env === "production" ? "promote-production" : "deploy-staging", flag("outcome", "auto") as Outcome);
      // Solo imágenes firmadas por CI (ADR 0277), en staging y en producción.
      verifySignature(flag("image") ?? fail("--image es obligatorio (REGIÓN-docker.pkg.dev/PROYECTO/dizaster/core)"), digest, env);
    }
    const target = targetFor(env, service, true);
    const url = flag("url");
    const dry = !flags.has("execute");
    const res = await rollout(target, digest, async (rev, stage) => {
      if (dry) return [{ name: "en seco", ok: true, ms: 0, detail: "sin verificación" }];
      const base = stage === "candidate" ? rev.url ?? url : url;
      if (!base) return [{ name: "verificación", ok: false, ms: 0, detail: "sin URL (--url)" }];
      return runChecks(base);
    }, flag("percents", "10,100")!.split(",").map(Number));
    const configSha = flag("config") ? createHash("sha256").update(readFileSync(flag("config")!)).digest("hex") : undefined;
    appendRelease(releases, {
      env, service, revision: res.revision, outcome: dry ? "dry-run" : res.outcome, previous: res.previous, configSha, migration: latestMigration(),
      at: new Date().toISOString(), actor: flag("actor", "human")!,
    });
    appendAudit(flag("log", "delivery-audit.jsonl")!, {
      actor: flag("actor", "human") as Actor, action: cmd, environment: env === "local" ? "development" : env, artifactDigest: digest,
      result: dry ? "ok" : res.outcome === "deployed" ? "ok" : res.outcome === "rolled-back" ? "rolled-back" : "failed",
      details: { dryRun: dry, steps: res.steps },
    });
    out(res, () => [`${dry ? "[en seco] " : ""}${res.outcome}: ${res.revision.name} (${digest.slice(0, 19)}…)`,
      ...res.steps.map((st) => `  ${st.ok ? "✓" : "✗"} ${st.stage}${st.failed.length ? ` — ${st.failed.join("; ")}` : ""}`)].join("\n"));
    if (!dry && res.outcome !== "deployed") process.exit(1);
    break;
  }
  case "rollback": {
    const env = flag("env", "staging") as "staging" | "production" | "local";
    if (!["staging", "production", "local"].includes(env)) fail("--env: staging, production o local");
    const service = flag("service", "api")!;
    const releases = flag("releases", "delivery-releases.jsonl")!;
    const history = readReleases(releases);
    if (env !== "local") guard(env === "production" ? "rollback-production" : "rollback-staging");
    const to = flag("to") && flag("to") !== "previous"
      ? history.filter((r) => r.env === env && r.service === service && r.outcome === "deployed" && r.revision.digest === flag("to")).at(-1) ?? fail("Ese digest no se desplegó en este entorno.")
      : rollbackCandidate(history, env, service) ?? fail("No hay versión anterior registrada para volver.");
    const target = targetFor(env, service, false);
    await rollbackTo(target, to.revision);
    const serving = lastServing(history, env, service);
    appendRelease(releases, { ...to, outcome: flags.has("execute") ? "rollback" : "dry-run", previous: serving?.revision ?? null, at: new Date().toISOString(), actor: flag("actor", "human")! });
    appendAudit(flag("log", "delivery-audit.jsonl")!, { actor: flag("actor", "human") as Actor, action: "rollback", environment: env === "local" ? "development" : env, artifactDigest: to.revision.digest, result: "ok", details: { dryRun: !flags.has("execute"), migration: to.migration } });
    console.log(`${flags.has("execute") ? "" : "[en seco] "}tráfico al 100 % en ${to.revision.name} (${to.revision.digest.slice(0, 19)}…); esquema compatible hasta ${to.migration ?? "—"}`);
    break;
  }
  case "agent": {
    // Delivery Agent opcional (ADR 0283): propone pasos; el ejecutor los valida y cada comando vuelve a pasar sus gates.
    const policy = loadPolicy(flag("policy"));
    const env = flag("env", "staging") as "staging" | "production" | "local";
    if (!["staging", "production", "local"].includes(env)) fail("--env: staging, production o local");
    const { impact: im } = impact();
    const history = readReleases(flag("releases", "delivery-releases.jsonl")!).filter((r) => r.env === env);
    const proposal = await new RuleAgent().propose({ impact: im, policy, env, digest: flag("digest"), lastOutcome: history.at(-1)?.outcome ?? null });
    const inject = Object.fromEntries(["image", "project", "region", "url", "env-file", "state", "base-port", "files", "base", "head", "worktree", "policy"].filter((k) => flags.has(k)).map((k) => [k, flag(k)!]));
    const outcome = env === "local" ? "auto" : outcomeFor(policy, im.risk, env);
    const steps = validateProposal(proposal, policy, outcome, flags.has("execute"), inject);
    out({ proposal, steps }, () => [
      `Agente ${proposal.agent} (${env}, riesgo ${im.risk}, política ${outcome}, nivel ${policy.autonomyLevel}):`,
      ...steps.map((v, i) => `  ${i + 1}. ${v.allowed ? "✓" : "✗"} dzd ${v.argv.join(" ") || v.step.command}  # ${v.step.why}${v.allowed ? "" : ` — ${v.reason}`}`),
      proposal.stop ? `  ■ se detiene: ${proposal.stop.reason} (${proposal.stop.needs})` : "",
    ].filter(Boolean).join("\n"));
    if (rest[0] !== "run") break;
    for (const v of steps) {
      if (!v.allowed) fail(`Detenido en ${v.step.command}: ${v.reason}`, 3);
      console.log(`▶ dzd ${v.argv.join(" ")}`);
      const r = spawnSync(process.execPath, [process.argv[1]!, ...v.argv], { stdio: "inherit" });
      if (r.status !== 0) fail(`✗ ${v.step.command} falló (código ${r.status}); el agente no continúa.`);
    }
    appendAudit(flag("log", "delivery-audit.jsonl")!, { actor: `agent:${proposal.agent}`, action: "agent-run", environment: env === "local" ? "development" : env, artifactDigest: flag("digest"), result: "ok", details: { steps: steps.map((v) => v.step.command), stop: proposal.stop ?? null } });
    if (proposal.stop) { console.log(`■ ${proposal.stop.reason}`); process.exit(proposal.stop.needs === "owner-approval" ? 3 : 0); }
    break;
  }
  case "local-proxy": {
    const port = Number(flag("port", "8088"));
    startProxy(flag("state", ".dzd/local-state.json")!, port);
    console.log(`proxy local en http://127.0.0.1:${port} (estado ${flag("state", ".dzd/local-state.json")})`);
    break;
  }
  case "load": {
    const url = flag("url") ?? fail("--url es obligatorio");
    const samples = await runLoad({ url, requests: Number(flag("requests", "200")), concurrency: Number(flag("concurrency", "10")), paths: flag("paths")?.split(",") });
    if (flag("out")) writeFileSync(flag("out")!, `${JSON.stringify(samples)}\n`);
    const r = evaluateSlo(fromSamples(samples), loadPolicy(flag("policy")).slo, { smoke: true });
    printSlo(r);
    if (!r.ok) process.exit(1);
    break;
  }
  default:
    console.log("uso: dzd <inspect|plan|policy|run-gates|autonomy|audit [verify|stats]|artifact [verify]|verify [--repeat N --slo]|slo|env-check|github-guard|provenance [verify]|signature verify|iac-check|diagnose|docs|report|cost|config-check|deploy|promote|rollback [--env local]|local-proxy|load|agent [run]> [--json]");
    if (cmd) process.exit(1);
}
