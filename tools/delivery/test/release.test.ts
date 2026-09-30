import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AuditRecord } from "../src/audit.js";
import { analyze } from "../src/inspect.js";
import { planGates } from "../src/plan.js";
import { loadPolicy } from "../src/policy.js";
import { lastServing, promotable, rollbackCandidate, type ReleaseRecord } from "../src/releases.js";
import { markdownReport } from "../src/report.js";
import { deliveryStats } from "../src/stats.js";
import { localEnv } from "./cli-env.js";

// Despliegue, promoción, rollback, métricas e informe del Delivery Plane (ADR 0272). Sin nube ni red.
const root = new URL("../../../", import.meta.url).pathname;
const policy = loadPolicy(`${root}delivery/policy.json`);
const D = (n: number) => `sha256:${String(n).repeat(64).slice(0, 64)}`;
const rel = (env: "staging" | "production", n: number, outcome: ReleaseRecord["outcome"], at: string): ReleaseRecord =>
  ({ env, service: "api", revision: { name: `api-${n}`, digest: D(n) }, outcome, previous: null, at, actor: "human" });
const cli = (args: string[], cwd = root) => spawnSync(process.execPath, [`${root}tools/delivery/dist/cli.js`, ...args], { cwd, encoding: "utf8", env: localEnv() });

describe("versiones y rollback", () => {
  const h = [rel("staging", 1, "deployed", "2026-09-01"), rel("staging", 2, "deployed", "2026-09-02"), rel("staging", 3, "rolled-back", "2026-09-03")];
  it("el rollback vuelve a la versión anterior servida, no a la fallida", () => {
    expect(lastServing(h, "staging", "api")?.revision.digest).toBe(D(2));
    expect(rollbackCandidate(h, "staging", "api")?.revision.digest).toBe(D(1));
  });
  it("tras un rollback, el siguiente no se queda en la misma versión", () => {
    const after = [...h, { ...rel("staging", 1, "rollback", "2026-09-04") }];
    expect(lastServing(after, "staging", "api")?.revision.digest).toBe(D(1));
    expect(rollbackCandidate(after, "staging", "api")?.revision.digest).toBe(D(2));
  });
  it("a producción solo se promueve un digest desplegado en staging", () => {
    expect(promotable(h, "api", D(2))).toBe(true);
    expect(promotable(h, "api", D(3))).toBe(false);
    expect(promotable(h, "api", D(9))).toBe(false);
  });
});

describe("métricas de entrega", () => {
  const a = (action: string, result: AuditRecord["result"], at: string): AuditRecord =>
    ({ action, result, at, actor: "delivery-plane", environment: "staging", id: at, prevHash: "", hash: "" });
  it("frecuencia, tasa de fallos y recuperación salen del registro de auditoría", () => {
    const st = deliveryStats([
      a("deploy", "ok", "2026-09-01T10:00:00Z"), a("deploy", "rolled-back", "2026-09-05T10:00:00Z"),
      a("deploy", "ok", "2026-09-05T10:30:00Z"), a("deploy", "ok", "2026-09-15T10:00:00Z"), a("ci", "ok", "2026-09-15T10:00:00Z"),
    ]);
    expect(st.deploys).toBe(4);
    expect(st.changeFailureRate).toBe(0.25);
    expect(st.medianRecoveryMinutes).toBe(30);
    expect(st.deploysPerWeek).toBeCloseTo(2, 1);
    expect(st.byAction["ci"]).toEqual({ ok: 1, failed: 0, blocked: 0 });
  });
  it("sin despliegues no inventa cifras", () => {
    expect(deliveryStats([])).toMatchObject({ deploys: 0, changeFailureRate: null, deploysPerWeek: null, medianRecoveryMinutes: null });
  });
});

describe("informe para el PR", () => {
  it("resume riesgo, política por entorno y gates", () => {
    const im = analyze([{ path: "services/core/migrations/0999_x.sql", status: "A" }], policy, { pkgs: [], readFile: () => "CREATE INDEX x ON y (z);" });
    const md = markdownReport(im, planGates(im), { staging: "auto", production: "approval" });
    expect(md).toContain("## Dizaster Delivery Plane");
    expect(md).toContain("**producción:** approval");
    expect(md).toContain("pnpm db:restore-check");
  });
});

describe("CLI en seco", () => {
  it("deploy en seco imprime gcloud por digest y registra la versión sin tocar la nube", () => {
    const dir = mkdtempSync(join(tmpdir(), "dzd-rel-"));
    const args = ["--project", "p", "--region", "r", "--image", "img", "--releases", join(dir, "rel.jsonl"), "--log", join(dir, "audit.jsonl")];
    const r = cli(["deploy", "--env", "staging", "--digest", D(4), ...args]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("[en seco] gcloud run deploy api --image=img@" + D(4));
    expect(JSON.parse(readFileSync(join(dir, "rel.jsonl"), "utf8").trim()).outcome).toBe("dry-run");
    // Un digest nunca desplegado en staging no se promueve.
    const p = cli(["promote", "--digest", D(4), ...args]);
    expect(p.status).toBe(1);
    expect(p.stderr).toContain("ya desplegado y verificado en staging");
  });
  it("la automatización no despliega por encima de su nivel de autonomía", () => {
    const dir = mkdtempSync(join(tmpdir(), "dzd-rel-"));
    const r = cli(["deploy", "--env", "staging", "--digest", D(5), "--actor", "claude", "--project", "p", "--region", "r", "--image", "img", "--releases", join(dir, "rel.jsonl"), "--log", join(dir, "a.jsonl")]);
    expect(r.status).toBe(3);
    expect(r.stderr).toContain("requiere nivel 4");
  });
  it("config-check usa las reglas del backend y rechaza una configuración de producción insegura", () => {
    const dir = mkdtempSync(join(tmpdir(), "dzd-cfg-"));
    const f = join(dir, "prod.env");
    writeFileSync(f, "NODE_ENV=production\nDATABASE_URL=secret:database-url\nAUTH_JWT_SECRET=secret:auth-jwt-secret\nDEV_AUTH_ENABLED=true\n");
    const bad = cli(["config-check", "--env-file", f]);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain("DEV_AUTH_ENABLED");
    expect(bad.stderr).not.toContain("placeholder");
  });
});
