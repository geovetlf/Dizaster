import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ArtifactManifest } from "../src/artifact.js";
import { checkEnvironment, declaredVariables, tfvarsEntries } from "../src/envcheck.js";
import { loadPolicy, validatePolicy } from "../src/policy.js";
import { buildProvenance, contextFromEnv, verifyProvenance } from "../src/provenance.js";
import { checkVerifyOutput, cosignVerifyArgs, identityRegexp, type SigningPolicy } from "../src/signing.js";
import { evaluateSlo, fromK6Summary, fromSamples, percentile } from "../src/slo.js";

// Firma, procedencia, SLO y validación de entornos (ADR 0277). Sin nube, sin red, sin cosign.
const root = new URL("../../../", import.meta.url).pathname;
const policy = loadPolicy(`${root}delivery/policy.json`);
const D = `sha256:${"a".repeat(64)}`;
const OTHER = `sha256:${"b".repeat(64)}`;
const COMMIT = "c".repeat(40);
const signing: SigningPolicy = { ...policy.signing, repository: "dizaster-org/dizaster" };
const cli = (args: string[]) => spawnSync(process.execPath, [`${root}tools/delivery/dist/cli.js`, ...args], { cwd: root, encoding: "utf8" });

describe("firma keyless", () => {
  it("la política versionada exige firma y aún no tiene repositorio (D-24)", () => {
    expect(policy.signing.required).toBe(true);
    expect(policy.signing.repository).toBeNull();
    expect(() => identityRegexp(policy.signing)).toThrow(/D-24/);
  });
  it("la firma no se puede apagar ni abrir a cualquier rama", () => {
    expect(() => validatePolicy({ ...policy, signing: { ...policy.signing, required: false } })).toThrow(/required/);
    expect(() => validatePolicy({ ...policy, signing: { ...policy.signing, refs: ["refs/heads/*"] } })).toThrow(/ramas arbitrarias/);
    expect(() => validatePolicy({ ...policy, signing: { ...policy.signing, issuer: "https://evil.example" } })).toThrow(/issuer/);
  });
  it("solo acepta el workflow del repositorio desde main", () => {
    const re = new RegExp(identityRegexp(signing));
    expect(re.test("https://github.com/dizaster-org/dizaster/.github/workflows/ci.yml@refs/heads/main")).toBe(true);
    expect(re.test("https://github.com/fork/dizaster/.github/workflows/ci.yml@refs/heads/main")).toBe(false);
    expect(re.test("https://github.com/dizaster-org/dizaster/.github/workflows/ci.yml@refs/heads/feature")).toBe(false);
    expect(re.test("https://github.com/dizaster-org/dizaster/.github/workflows/other.yml@refs/heads/main")).toBe(false);
    expect(re.test("https://github.com/dizaster-org/dizasterX/.github/workflows/ci.yml@refs/heads/main")).toBe(false);
  });
  it("etiquetas con comodín solo cubren nombres de versión", () => {
    const re = new RegExp(identityRegexp({ ...signing, refs: ["refs/tags/v*"] }));
    expect(re.test("https://github.com/dizaster-org/dizaster/.github/workflows/ci.yml@refs/tags/v1.2.3")).toBe(true);
    expect(re.test("https://github.com/dizaster-org/dizaster/.github/workflows/ci.yml@refs/tags/v1/../x")).toBe(false);
  });
  it("se verifica por digest, nunca por etiqueta", () => {
    expect(cosignVerifyArgs(signing, "r-docker.pkg.dev/p/dizaster/core", D).at(-1)).toBe(`r-docker.pkg.dev/p/dizaster/core@${D}`);
    expect(() => cosignVerifyArgs(signing, "r-docker.pkg.dev/p/dizaster/core:latest", D)).toThrow(/etiqueta/);
    expect(() => cosignVerifyArgs(signing, "r/core", "sha256:corto")).toThrow(/digest/);
    expect(cosignVerifyArgs(signing, "localhost:5000/core", D, "k.pub")).toContain("--allow-http-registry");
    expect(cosignVerifyArgs(signing, "r-docker.pkg.dev/p/dizaster/core", D, "k.pub")).not.toContain("--allow-http-registry");
  });
  it("lo firmado tiene que ser exactamente este digest", () => {
    const out = (d: string) => JSON.stringify([{ critical: { image: { "docker-manifest-digest": d } } }]);
    expect(checkVerifyOutput(out(D), D)).toEqual([]);
    expect(checkVerifyOutput(out(OTHER), D)[0]).toMatch(/ninguna firma/);
    expect(checkVerifyOutput("[]", D)[0]).toMatch(/no devolvió/);
    expect(checkVerifyOutput("basura", D)[0]).toMatch(/no devolvió/);
    expect(checkVerifyOutput("[{", D)[0]).toMatch(/JSON/);
  });
  it("staging y producción rechazan una clave local; en seco se explica el bloqueo D-24", () => {
    expect(cli(["signature", "verify", "--image", "r/p/dizaster/core", "--digest", D, "--env", "production", "--key", "k.pub"]).status).toBe(1);
    const dry = cli(["signature", "verify", "--image", "r/p/dizaster/core", "--digest", D]);
    expect(dry.status).toBe(0);
    expect(dry.stdout).toMatch(/D-24/);
  });
  it("promover sin firma verificable no llega a ejecutar nada", () => {
    const dir = mkdtempSync(join(tmpdir(), "dzd-"));
    const releases = join(dir, "r.jsonl");
    writeFileSync(releases, `${JSON.stringify({ env: "staging", service: "api", revision: { name: "a", digest: D }, outcome: "deployed", previous: null, at: "2026-09-30", actor: "human" })}\n`);
    const r = cli(["promote", "--digest", D, "--releases", releases, "--project", "p", "--region", "r", "--image", "r/p/dizaster/core", "--execute", "--log", join(dir, "a.jsonl")]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Firma no verificable/);
  });
});

describe("procedencia SLSA", () => {
  const m: ArtifactManifest = { name: "core", version: "1", commit: COMMIT, builtAt: "2026-09-30T00:00:00Z", digest: OTHER, imageDigest: D, buildEnv: { node: "v22" }, tests: "passed", security: "passed" };
  const ctx = contextFromEnv({ GITHUB_REPOSITORY: "dizaster-org/dizaster", GITHUB_REF: "refs/heads/main", GITHUB_WORKFLOW_REF: "dizaster-org/dizaster/.github/workflows/ci.yml@refs/heads/main", GITHUB_RUN_ID: "42" })!;
  const p = buildProvenance(m, "r/p/dizaster/core", ctx);
  const expect0 = { digest: D, commit: COMMIT, repository: "dizaster-org/dizaster", workflows: policy.signing.workflows, refs: policy.signing.refs };
  it("lee el contexto de GitHub Actions", () => {
    expect(ctx.workflowPath).toBe(".github/workflows/ci.yml");
    expect(contextFromEnv({})).toBeNull();
  });
  it("describe el digest de la imagen y el commit", () => {
    expect(p.subject[0]!.digest.sha256).toBe("a".repeat(64));
    expect(verifyProvenance(p, expect0)).toEqual([]);
  });
  it("rechaza otro digest, otro commit, otro repositorio, otra rama o pruebas sin pasar", () => {
    expect(verifyProvenance(p, { ...expect0, digest: OTHER }).join()).toMatch(/no es de/);
    expect(verifyProvenance(p, { ...expect0, commit: "d".repeat(40) }).join()).toMatch(/commit/);
    expect(verifyProvenance(p, { ...expect0, repository: "otro/repo" }).join()).toMatch(/repositorio/);
    const branch = buildProvenance(m, "r", { ...ctx, ref: "refs/heads/feature" });
    expect(verifyProvenance(branch, expect0).join()).toMatch(/ref no permitida/);
    expect(verifyProvenance(buildProvenance({ ...m, tests: "failed" }, "r", ctx), expect0).join()).toMatch(/pruebas/);
  });
  it("sin digest de imagen no hay procedencia", () => {
    expect(() => buildProvenance({ ...m, imageDigest: undefined }, "r", ctx)).toThrow();
  });
});

describe("SLO", () => {
  const t = policy.slo;
  it("usa el objetivo del Blueprint (p95 < 300 ms) y no inventa una tasa de errores", () => {
    expect(t.apiP95Ms).toBe(300);
    expect(t.maxErrorRate).toBeNull();
  });
  it("percentil nearest-rank", () => {
    expect(percentile([], 95)).toBeNull();
    expect(percentile(Array.from({ length: 100 }, (_, i) => i + 1), 95)).toBe(95);
  });
  it("p95 lento falla; pocas muestras no se juzgan", () => {
    const slow = Array.from({ length: 40 }, () => ({ ms: 400, status: 200 }));
    expect(evaluateSlo(fromSamples(slow), t).ok).toBe(false);
    expect(evaluateSlo(fromSamples(slow.slice(0, 3)), t).ok).toBe(true);
  });
  it("un 5xx en humo bloquea siempre; la tasa sin objetivo solo informa", () => {
    const s = [...Array.from({ length: 30 }, () => ({ ms: 50, status: 200 })), { ms: 50, status: 503 }];
    expect(evaluateSlo(fromSamples(s), t, { smoke: true }).ok).toBe(false);
    const r = evaluateSlo(fromSamples(s), t);
    expect(r.ok).toBe(true);
    expect(r.findings.find((f) => f.check === "tasa de errores")?.enforced).toBe(false);
    expect(evaluateSlo(fromSamples(s), { ...t, maxErrorRate: 0.01 }).ok).toBe(false);
  });
  it("lee el resumen de k6", () => {
    const o = fromK6Summary({ metrics: { http_reqs: { count: 200 }, http_req_duration: { "p(95)": 120 }, http_req_failed: { value: 0 } } });
    expect(o).toMatchObject({ samples: 200, p95Ms: 120, errorRate: 0, serverErrors: 0 });
    expect(evaluateSlo(o, t).ok).toBe(true);
  });
  it("dzd slo sale con error si se incumple", () => {
    const dir = mkdtempSync(join(tmpdir(), "dzd-"));
    const f = join(dir, "k6.json");
    writeFileSync(f, JSON.stringify({ metrics: { http_reqs: { count: 100 }, http_req_duration: { "p(95)": 900 } } }));
    const r = cli(["slo", "--k6", f]);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/900 ms/);
  });
});

describe("validación de entorno", () => {
  const mainTf = readFileSync(`${root}infra/tofu/envs/staging/main.tf`, "utf8");
  const example = readFileSync(`${root}infra/tofu/envs/staging/staging.tfvars.example`, "utf8");
  const good = example.replace(/<[^>]+>/g, (x) => (/número|días|presupuesto/.test(x) ? "1" : "x"))
    .replace(/image\s*=.*/, `image = "r-docker.pkg.dev/p/dizaster/core@${D}"`)
    .replace(/public_api_url\s*=.*/, `public_api_url = "https://api.example.org"`)
    .replace(/project_id\s*=\s*".*"/, `project_id = "dz-staging"`);
  it("lee las variables obligatorias y el tfvars", () => {
    const req = declaredVariables(mainTf).filter((v) => v.required).map((v) => v.name);
    expect(req).toContain("billing");
    expect(req).not.toContain("extra_env");
    expect(tfvarsEntries(example).get("storage")).toMatch(/bucket/);
  });
  it("el ejemplo tal cual está incompleto: los valores del propietario no se inventan", () => {
    const f = checkEnvironment({ env: "staging", mainTf, tfvars: example });
    expect(f.filter((x) => x.severity === "block").length).toBeGreaterThan(5);
  });
  it("un tfvars completo pasa", () => {
    expect(checkEnvironment({ env: "staging", mainTf, tfvars: good }).filter((x) => x.severity === "block")).toEqual([]);
  });
  it("imagen por etiqueta, http, secretos en claro o proyecto compartido bloquean", () => {
    const msgs = (tfvars: string, extra: Partial<Parameters<typeof checkEnvironment>[0]> = {}) =>
      checkEnvironment({ env: "production", mainTf, tfvars, ...extra }).map((x) => x.message).join("\n");
    expect(msgs(good.replace(/@sha256:[0-9a-f]+/, ":latest"))).toMatch(/digest/);
    expect(msgs(good.replace("https://api", "http://api"))).toMatch(/https/);
    expect(msgs(`${good}\ndb_password = "hunter2"\n`)).toMatch(/Secret Manager/);
    expect(msgs(good, { otherTfvars: good })).toMatch(/compartir proyecto/);
    expect(msgs(good, { repository: "a/b" })).toMatch(/no coincide/);
    expect(msgs(good.replace(/api_min_instances\s*=\s*1/, "api_min_instances = 5"))).toMatch(/min/);
  });
  it("la configuración del runtime declara secretos por referencia", () => {
    const f = checkEnvironment({ env: "production", mainTf, runtimeEnv: { AUTH_JWT_SECRET: "abc", DATABASE_URL: "postgres://u:p@h/db", NODE_ENV: "development", SENTRY_DSN: "secret:sentry" } });
    const m = f.map((x) => x.message).join("\n");
    expect(m).toMatch(/AUTH_JWT_SECRET/);
    expect(m).toMatch(/DATABASE_URL/);
    expect(m).toMatch(/NODE_ENV/);
    expect(m).not.toMatch(/SENTRY_DSN/);
  });
});

describe("quién cuenta como humano", () => {
  it("en local la persona que teclea; en CI solo los owners de la política", async () => {
    const { isHuman } = await import("../src/autonomy.js");
    expect(isHuman("human", [], {})).toBe(true);
    expect(isHuman("human", [], { GITHUB_ACTIONS: "true" })).toBe(false);
    expect(isHuman("github:geovet", ["geovet"])).toBe(true);
    expect(isHuman("github:claude[bot]", ["geovet"])).toBe(false);
    expect(isHuman("ci", ["geovet"])).toBe(false);
    expect(policy.owners).toEqual([]);
  });
  it("un bot no puede declararse propietario en la política", () => {
    expect(() => validatePolicy({ ...policy, owners: ["claude[bot]"] })).toThrow(/owners/);
  });
  it("un actor de CI sin estar en owners no despliega a staging en el nivel vigente", () => {
    const dir = mkdtempSync(join(tmpdir(), "dzd-"));
    const r = cli(["deploy", "--env", "staging", "--digest", D, "--releases", join(dir, "r.jsonl"), "--log", join(dir, "a.jsonl"), "--project", "p", "--region", "r", "--image", "r/p/dizaster/core", "--actor", "github:alguien"]);
    expect(r.status).toBe(3);
  });
});
