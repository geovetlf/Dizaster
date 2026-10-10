import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { apiReadOf, checkGithubGuards, requiredChecksOf, verifiedSummary, type ApiRead } from "../src/github-guard.js";

// Guardas de GitHub antes de entregar (ADR 0303).
const ruleset = JSON.parse(readFileSync(new URL("../../../.github/rulesets/main.json", import.meta.url), "utf8"));
const checks = requiredChecksOf(ruleset);
const effective = ruleset.rules.map((r: object) => ({ ...r, ruleset_source_type: "Repository", ruleset_id: 1 }));
const productionBody = {
  can_admins_bypass: false,
  protection_rules: [{ type: "required_reviewers", reviewers: [{ type: "User", reviewer: { login: "geovetlf", id: 1 } }] }],
  deployment_branch_policy: { protected_branches: true, custom_branch_policies: false },
};
const stagingBody = { can_admins_bypass: true, protection_rules: [], deployment_branch_policy: { protected_branches: true, custom_branch_policies: false } };
const read = (body: unknown): ApiRead => ({ ok: true, body });
const rules = read(effective);
const production = read(productionBody);
const staging = read(stagingBody);
const base = { branchRules: rules, requiredChecks: checks, owners: ["geovetlf"] };

describe("guardas de GitHub", () => {
  it("el ruleset versionado exige los 7 checks de CI, PR, sin force-push ni borrado y sin bypass", () => {
    expect(checks.sort()).toEqual(["check", "delivery", "iac", "image", "report-comment", "security", "supply-chain"]);
    expect(ruleset.bypass_actors).toEqual([]);
    expect(ruleset.enforcement).toBe("active");
    for (const r of ruleset.rules.filter((x: { type: string }) => x.type === "required_status_checks")) {
      for (const c of r.parameters.required_status_checks) expect(c.integration_id).toBe(15368);
    }
  });

  it("pasa desde main con las reglas aplicadas, staging limitado y production protegida", () => {
    expect(checkGithubGuards({ ...base, ref: "refs/heads/main", staging, production })).toEqual([]);
    expect(verifiedSummary({ staging: true, production: true })).toContain("sin bypass de administradores");
  });

  it("bloquea si main no está protegida o le falta un check", () => {
    expect(checkGithubGuards({ ...base, branchRules: read([]) }).map((f) => f.message)).toHaveLength(4);
    const sinImage = effective.map((r: { type: string; parameters?: { required_status_checks?: { context: string }[] } }) => r.type === "required_status_checks"
      ? { ...r, parameters: { ...r.parameters, required_status_checks: r.parameters!.required_status_checks!.filter((c) => c.context !== "image") } } : r);
    expect(checkGithubGuards({ ...base, branchRules: read(sinImage) })).toEqual([
      { severity: "block", kind: "incorrect", where: "main", message: "el check obligatorio image no se exige" },
    ]);
  });

  it("bloquea la entrega lanzada desde otra rama", () => {
    expect(checkGithubGuards({ ...base, ref: "refs/heads/feature" }).map((f) => [f.where, f.kind])).toEqual([["ref", "incorrect"]]);
  });

  it("bloquea la promoción sin entorno, sin owner revisor, con bypass de administradores o desde cualquier rama", () => {
    const g = (p: ApiRead) => checkGithubGuards({ ...base, production: p }).map((f) => f.message);
    expect(g({ ok: false, missing: true })).toEqual(["el entorno no existe: GitHub lo crearía al vuelo sin protecciones"]);
    expect(g(read({ ...productionBody, protection_rules: [{ type: "required_reviewers", reviewers: [{ type: "User", reviewer: { login: "otra" } }] }] }))).toHaveLength(1);
    expect(g(read({ ...productionBody, can_admins_bypass: true }))).toEqual(["los administradores pueden saltarse la aprobación"]);
    expect(g(read({ ...productionBody, can_admins_bypass: undefined }))).toEqual(["los administradores pueden saltarse la aprobación"]);
    expect(g(read({ ...productionBody, deployment_branch_policy: null }))).toEqual(["cualquier rama puede desplegar: debe limitarse a ramas protegidas"]);
  });

  it("staging debe existir y aceptar solo ramas protegidas", () => {
    const g = (s: ApiRead) => checkGithubGuards({ ...base, staging: s }).map((f) => [f.where, f.kind]);
    expect(g({ ok: false, missing: true })).toEqual([["staging", "incorrect"]]);
    expect(g(read({ ...stagingBody, deployment_branch_policy: null }))).toEqual([["staging", "incorrect"]]);
  });

  it("si la API no responde, distingue 'no verificable' de 'incorrecto' y también detiene la entrega", () => {
    const denied = apiReadOf({ error: "gh: Resource not accessible by integration (HTTP 403)\n" });
    expect(denied).toEqual({ ok: false, missing: false, error: "gh: Resource not accessible by integration (HTTP 403)" });
    expect(apiReadOf({ error: "gh: Not Found (HTTP 404)" })).toEqual({ ok: false, missing: true });
    expect(apiReadOf({ body: "<html>" })).toMatchObject({ ok: false, missing: false });
    expect(apiReadOf({ body: "[]" })).toEqual({ ok: true, body: [] });
    const findings = checkGithubGuards({ ...base, branchRules: denied, staging: denied, production: denied });
    expect(findings.map((f) => [f.where, f.kind])).toEqual([["main", "unverifiable"], ["staging", "unverifiable"], ["production", "unverifiable"]]);
    expect(findings[0]!.message).toContain("se detiene por seguridad");
  });
});
