import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkGithubGuards, requiredChecksOf } from "../src/github-guard.js";

// Guardas de GitHub antes de entregar (ADR 0303).
const ruleset = JSON.parse(readFileSync(new URL("../../../.github/rulesets/main.json", import.meta.url), "utf8"));
const checks = requiredChecksOf(ruleset);
const effective = ruleset.rules.map((r: object) => ({ ...r, ruleset_source_type: "Repository", ruleset_id: 1 }));
const production = {
  protection_rules: [{ type: "required_reviewers", reviewers: [{ type: "User", reviewer: { login: "geovetlf", id: 1 } }] }],
  deployment_branch_policy: { protected_branches: true, custom_branch_policies: false },
};

describe("guardas de GitHub", () => {
  it("el ruleset versionado exige los 7 checks de CI, PR, sin force-push ni borrado y sin bypass", () => {
    expect(checks.sort()).toEqual(["check", "delivery", "iac", "image", "report-comment", "security", "supply-chain"]);
    expect(ruleset.bypass_actors).toEqual([]);
    expect(ruleset.enforcement).toBe("active");
    for (const r of ruleset.rules.filter((x: { type: string }) => x.type === "required_status_checks")) {
      for (const c of r.parameters.required_status_checks) expect(c.integration_id).toBe(15368);
    }
  });

  it("pasa con las reglas aplicadas y production protegida", () => {
    expect(checkGithubGuards({ branchRules: effective, requiredChecks: checks, owners: ["geovetlf"], production })).toEqual([]);
  });

  it("bloquea si main no está protegida o le falta un check", () => {
    expect(checkGithubGuards({ branchRules: [], requiredChecks: checks, owners: ["geovetlf"] }).map((f) => f.message)).toHaveLength(4);
    const sinImage = effective.map((r: { type: string; parameters?: { required_status_checks?: { context: string }[] } }) => r.type === "required_status_checks"
      ? { ...r, parameters: { ...r.parameters, required_status_checks: r.parameters!.required_status_checks!.filter((c) => c.context !== "image") } } : r);
    expect(checkGithubGuards({ branchRules: sinImage, requiredChecks: checks, owners: ["geovetlf"] })).toEqual([
      { severity: "block", where: "main", message: "el check obligatorio image no se exige" },
    ]);
  });

  it("bloquea la promoción sin entorno, sin owner revisor o desde cualquier rama", () => {
    const g = (p: unknown) => checkGithubGuards({ branchRules: effective, requiredChecks: checks, owners: ["geovetlf"], production: p }).map((f) => f.message);
    expect(g(null)).toEqual(["el entorno no existe: GitHub lo crearía sin revisores"]);
    expect(g({ ...production, protection_rules: [{ type: "required_reviewers", reviewers: [{ type: "User", reviewer: { login: "otra" } }] }] })).toHaveLength(1);
    expect(g({ ...production, deployment_branch_policy: null })).toEqual(["cualquier rama puede desplegar: debe limitarse a ramas protegidas"]);
  });
});
