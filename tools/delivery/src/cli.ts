#!/usr/bin/env node
/**
 * dzd — Dizaster Delivery Control Plane (Blueprint §20, ADR 0260). Determinístico: sin IA, sin red salvo `verify`,
 * sin credenciales. GitHub Actions lo ejecuta; Claude y las personas también pueden ejecutarlo localmente.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { sha256File, verifyManifest, type ArtifactManifest } from "./artifact.js";
import { appendAudit, readLog, verifyLog, type Actor } from "./audit.js";
import { decide, LEVELS, type Action } from "./autonomy.js";
import { diagnose } from "./diagnose.js";
import { checkDocs } from "./docs.js";
import { checkIamHcl, checkPlan, type TofuPlan } from "./iac.js";
import { analyze, gitChanges, parseNameStatus, workspacePackages, type Change } from "./inspect.js";
import { loadPolicy, outcomeFor, type Environment, type Outcome } from "./policy.js";
import { planGates } from "./plan.js";
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

function fail(msg: string, code = 1): never {
  console.error(msg);
  process.exit(code);
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
    if (rest[0] === "verify") {
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
        builtAt: new Date().toISOString(), digest: sha256File(file), sbomDigest: flag("sbom") ? sha256File(flag("sbom")!) : undefined,
        buildEnv: { node: process.version, runner: process.env["RUNNER_OS"] }, tests: flag("tests", "skipped") as "passed", security: flag("security", "skipped") as "passed",
      };
      writeFileSync(flag("out", `${file}.manifest.json`)!, `${JSON.stringify(m, null, 2)}\n`);
      out(m, () => `manifiesto ${m.digest}`);
    }
    break;
  }
  case "verify": {
    const url = flag("url") ?? fail("--url es obligatorio");
    const r = await runChecks(url);
    out(r, () => r.map((c) => `${c.ok ? "✓" : "✗"} ${c.name} (${c.ms} ms) ${c.ok ? "" : c.detail}`).join("\n"));
    if (!allOk(r)) process.exit(1);
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
  default:
    console.log("uso: dzd <inspect|plan|policy|run-gates|autonomy|audit [verify]|artifact [verify]|verify|iac-check|diagnose|docs> [--json]");
    if (cmd) process.exit(1);
}
