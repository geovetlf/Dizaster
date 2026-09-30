import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sha256File, verifyManifest, type ArtifactManifest } from "../src/artifact.js";
import { appendAudit, readLog, verifyLog } from "../src/audit.js";
import { decide } from "../src/autonomy.js";
import { CloudRunTarget } from "../src/cloudrun.js";
import { costGate } from "../src/cost.js";
import { rollout, type DeployTarget, type Revision } from "../src/deploy.js";
import { diagnose } from "../src/diagnose.js";
import { checkDocs } from "../src/docs.js";
import { checkIamHcl, checkPlan } from "../src/iac.js";
import { loadPolicy } from "../src/policy.js";
import { runChecks, type Fetcher } from "../src/verify.js";

// Motores del Delivery Plane (ADR 0265). NO AI REQUIRED, sin red ni nube.
const root = new URL("../../../", import.meta.url).pathname;
const policy = loadPolicy(`${root}delivery/policy.json`);
const tmp = () => mkdtempSync(join(tmpdir(), "dzd-"));
const D = (n: number) => `sha256:${String(n).repeat(64).slice(0, 64)}`;

describe("niveles de autonomía y Permission Guard", () => {
  it("nivel 2 hoy: PRs sí; merge, staging y producción no", () => {
    expect(decide(2, "open-pr").allowed).toBe(true);
    expect(decide(2, "merge").allowed).toBe(false);
    expect(decide(2, "deploy-staging").allowed).toBe(false);
  });
  it("cada nivel hereda y la política manda", () => {
    expect(decide(3, "merge", "auto").allowed).toBe(true);
    expect(decide(3, "merge", "review")).toMatchObject({ allowed: false, needs: "review" });
    expect(decide(4, "deploy-staging", "auto").allowed).toBe(true);
    expect(decide(4, "promote-production", "auto").allowed).toBe(false);
    expect(decide(5, "promote-production", "auto").allowed).toBe(true);
    expect(decide(5, "promote-production", "approval")).toMatchObject({ allowed: false, needs: "owner-approval" });
    expect(decide(5, "deploy-staging", "block")).toMatchObject({ allowed: false, needs: "forbidden" });
  });
  it("prohibido en todo nivel; destroy y producción de base e infraestructura siempre con el propietario", () => {
    for (const a of ["read-secrets", "change-iam", "disable-gate", "delete-backup"] as const) expect(decide(5, a)).toMatchObject({ allowed: false, needs: "forbidden" });
    for (const a of ["destroy-infra", "migrate-production", "apply-infra-production"] as const) expect(decide(5, a)).toMatchObject({ allowed: false, needs: "owner-approval" });
    expect(decide(4, "rollback-staging", "block").allowed).toBe(true);
  });
});

describe("auditoría encadenada", () => {
  it("detecta cambios, borrados y reordenamientos", () => {
    const log = join(tmp(), "audit.jsonl");
    appendAudit(log, { actor: "claude", action: "open-pr", environment: "none" });
    appendAudit(log, { actor: "delivery-plane", action: "run-gates", environment: "none", result: "ok" });
    appendAudit(log, { actor: "human", action: "approve", environment: "production", approvedBy: "owner" });
    expect(verifyLog(readLog(log))).toEqual({ ok: true });
    const lines = readFileSync(log, "utf8").trim().split("\n");
    writeFileSync(log, `${lines[0]}\n${lines[1]!.replace("\"ok\"", "\"failed\"")}\n${lines[2]}\n`);
    expect(verifyLog(readLog(log))).toMatchObject({ ok: false, index: 1 });
    writeFileSync(log, `${lines[0]}\n${lines[2]}\n`);
    expect(verifyLog(readLog(log))).toMatchObject({ ok: false, index: 1 });
  });
});

describe("artefactos", () => {
  it("sin origen verificable no se despliega", () => {
    const dir = tmp();
    const f = join(dir, "image.tar");
    writeFileSync(f, "contenido");
    const m: ArtifactManifest = { name: "core", version: "1.0.0", commit: "a".repeat(40), builtAt: new Date().toISOString(), digest: sha256File(f), buildEnv: { node: "v22" }, tests: "passed", security: "passed" };
    expect(verifyManifest(m, sha256File(f))).toEqual([]);
    writeFileSync(f, "otro contenido");
    expect(verifyManifest(m, sha256File(f))[0]).toMatch(/no coincide/);
    expect(verifyManifest({ ...m, commit: "abc", tests: "failed" }, m.digest)).toHaveLength(2);
    expect(verifyManifest({ ...m, imageDigest: "latest" }, m.digest)).toEqual(["digest de imagen con formato inválido"]);
    expect(verifyManifest({ ...m, imageDigest: `sha256:${"b".repeat(64)}` }, m.digest)).toEqual([]);
  });
});

class FakeTarget implements DeployTarget {
  traffic = new Map<string, number>();
  revs: Revision[] = [{ name: "rev-1", digest: D(1) }];
  constructor() { this.traffic.set("rev-1", 100); }
  async current() { const n = [...this.traffic].find(([, p]) => p === 100)?.[0]; return this.revs.find((r) => r.name === n) ?? null; }
  async deploy(digest: string) { const r = { name: `rev-${this.revs.length + 1}`, digest }; this.revs.push(r); return r; }
  async shift(rev: Revision, p: number) { for (const k of this.traffic.keys()) this.traffic.set(k, 0); this.traffic.set(rev.name, p); }
}

describe("despliegue gradual y rollback", () => {
  const ok = { name: "vivo", ok: true, ms: 1, detail: "ok" };
  const bad = { name: "listo", ok: false, ms: 1, detail: "estado 503" };
  it("todo verde: la nueva revisión queda con el 100 %", async () => {
    const t = new FakeTarget();
    const r = await rollout(t, D(2), async () => [ok]);
    expect(r.outcome).toBe("deployed");
    expect(t.traffic.get("rev-2")).toBe(100);
  });
  it("falla sin tráfico: se rechaza y no se toca nada", async () => {
    const t = new FakeTarget();
    const r = await rollout(t, D(2), async (_rev, stage) => (stage === "candidate" ? [bad] : [ok]));
    expect(r.outcome).toBe("rejected");
    expect(t.traffic.get("rev-1")).toBe(100);
  });
  it("falla con tráfico: vuelve el 100 % a la anterior", async () => {
    const t = new FakeTarget();
    const r = await rollout(t, D(2), async (_rev, stage) => (stage === 10 ? [bad] : [ok]));
    expect(r.outcome).toBe("rolled-back");
    expect(t.traffic.get("rev-1")).toBe(100);
    expect(r.steps.at(-1)).toMatchObject({ stage: 10, ok: false });
  });
});

describe("Cloud Run (sin ejecutar: D-18)", () => {
  it("despliega por digest, sin tráfico, y mueve tráfico por revisión", async () => {
    const calls: string[] = [];
    const t = new CloudRunTarget({ project: "p", region: "r", service: "api", image: "reg/core" }, async (c, a) => { calls.push([c, ...a].join(" ")); return ""; });
    await t.deploy(D(3));
    await t.shift({ name: "api-00002", digest: D(3) }, 10);
    expect(calls[0]).toContain(`--image=reg/core@${D(3)}`);
    expect(calls[0]).toContain("--no-traffic");
    expect(calls[1]).toContain("--to-revisions=api-00002=10");
    await expect(t.deploy("latest")).rejects.toThrow(/digest/);
  });
});

describe("verificación post-despliegue", () => {
  it("estado, latencia y contenido", async () => {
    const fetcher: Fetcher = async (url) => ({ status: url.endsWith("/health/ready") ? 503 : 200, text: async () => "{\"openapi\":\"3.1.0\"}" });
    const r = await runChecks("http://x", undefined, fetcher);
    expect(r.map((c) => c.ok)).toEqual([true, false, true]);
  });
});

describe("IaC, costo, documentación y diagnóstico", () => {
  it("nunca destruye recursos con datos; lo que puede costar pide aprobación", () => {
    const f = checkPlan({ resource_changes: [
      { address: "google_sql_database_instance.main", type: "google_sql_database_instance", change: { actions: ["delete", "create"] } },
      { address: "google_cloud_run_v2_service.api", type: "google_cloud_run_v2_service", change: { actions: ["create"] } },
      { address: "google_service_account.ci", type: "google_service_account", change: { actions: ["create"] } },
    ] }, policy.cost);
    expect(f.filter((x) => x.severity === "block").map((x) => x.address)).toEqual(["google_sql_database_instance.main"]);
    expect(f.filter((x) => x.severity === "approval").map((x) => x.address)).toContain("google_cloud_run_v2_service.api");
    expect(f.map((x) => x.address)).not.toContain("google_service_account.ci");
    expect(checkIamHcl('role = "roles/editor"', "iam.tf")[0]?.severity).toBe("block");
    expect(checkIamHcl('role = "roles/run.developer"', "iam.tf")).toEqual([]);
  });
  it("sin presupuesto definido, cualquier gasto se bloquea", () => {
    expect(costGate(policy.cost, {}, { resource: "cloud-usd", estimate: 1 }).allowed).toBe(false);
    expect(costGate(policy.cost, {}, { resource: "cloud-usd", estimate: 0 }).allowed).toBe(true);
    expect(costGate({ ...policy.cost, monthly: { "ci-minutes": 100 } }, { "ci-minutes": 90 }, { resource: "ci-minutes", estimate: 20 }).allowed).toBe(false);
  });
  it("una migración sin documentación se señala", () => {
    expect(checkDocs(["services/core/migrations/0999_x.sql"], policy.docRules)).toHaveLength(1);
    expect(checkDocs(["services/core/migrations/0999_x.sql", "docs/adr/0999-x.md"], policy.docRules)).toEqual([]);
  });
  it("clasifica fallos conocidos", () => {
    expect(diagnose("src/a.ts(3,1): error TS2322: Type 'x'").kind).toBe("typecheck");
    expect(diagnose(" FAIL  test/a.test.ts > algo\nAssertionError: expected 1").kind).toBe("test");
    expect(diagnose("npm ERR! network ECONNRESET")).toMatchObject({ kind: "infra-runner", retryable: true });
    expect(diagnose("algo raro").kind).toBe("unknown");
  });
});
