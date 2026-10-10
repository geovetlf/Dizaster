#!/usr/bin/env node
// Conecta este repositorio local con el repositorio remoto de GitHub cuando exista (D-24, ADR 0277), sin rediseñar
// nada. En seco por defecto: imprime cada paso. Con --execute usa `gh` con la sesión de quien lo ejecuta; nunca crea
// el repositorio ni pide ni guarda tokens.
//
//   node scripts/github-bootstrap.mjs --repo OWNER/REPO --owner LOGIN [--outputs tofu-outputs.json] [--execute]
//   node scripts/github-bootstrap.mjs --repo OWNER/REPO --owner LOGIN --only rules [--execute]
//
// `--only rules` es para un repositorio que ya existe (ADR 0303): solo rulesets y entornos (pasos 3 y 4).
//
// Pasos: 1) política (signing.repository, owners) y CODEOWNERS; 2) push de main y etiquetas; 3) rulesets de main y de
// etiquetas; 4) entornos staging y production (production con el propietario como revisor obligatorio);
// 5) variables no secretas de Actions a partir de las salidas de OpenTofu. Los secretos (EXPO_TOKEN) los carga el
// propietario en GitHub; este script no los ve.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const execute = args.includes("--execute");
const onlyRules = opt("only") === "rules";
const repo = opt("repo");
const owner = opt("owner");
if (!repo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || !owner || !/^[A-Za-z0-9-]{1,39}$/.test(owner)) {
  console.error("uso: node scripts/github-bootstrap.mjs --repo OWNER/REPO --owner LOGIN [--outputs tofu-outputs.json] [--execute]");
  process.exit(1);
}

const run = (cmd, argv, input) => {
  console.log(`${execute ? "▶" : "[en seco]"} ${cmd} ${argv.join(" ")}`);
  if (!execute) return "";
  return execFileSync(cmd, argv, { encoding: "utf8", input, stdio: [input ? "pipe" : "ignore", "pipe", "inherit"] });
};

// 1) Política y CODEOWNERS: cambios versionados; van en un commit propio que revisa el propietario.
const policyPath = "delivery/policy.json";
const policy = readFileSync(policyPath, "utf8");
const nextPolicy = policy
  .replace(/"repository": (null|"[^"]*")/, `"repository": "${repo}"`)
  .replace(/"owners": \[[^\]]*\]/, `"owners": ["${owner}"]`);
const codeowners = readFileSync(".github/CODEOWNERS.template", "utf8").replaceAll("@OWNER", `@${owner}`)
  .split("\n").filter((l) => !l.startsWith("# Plantilla")).join("\n");
if (!onlyRules) console.log(`${execute ? "▶" : "[en seco]"} delivery/policy.json: signing.repository = ${repo}, owners = [${owner}]; .github/CODEOWNERS`);
if (execute && !onlyRules) {
  writeFileSync(policyPath, nextPolicy);
  writeFileSync(".github/CODEOWNERS", codeowners);
  run("git", ["add", policyPath, ".github/CODEOWNERS"]);
  run("git", ["commit", "-m", `Conectar el repositorio ${repo}: identidad de firma y propietario (D-24, ADR 0277)`]);
}

// 2) Historia completa: main y etiquetas. Sin --force: si el remoto ya tiene commits, se detiene.
if (!onlyRules) {
  const remotes = execute ? run("git", ["remote"]) : "";
  if (!remotes.split("\n").includes("origin")) run("git", ["remote", "add", "origin", `https://github.com/${repo}.git`]);
  run("git", ["push", "-u", "origin", "main"]);
  run("git", ["push", "origin", "--tags"]);
}

// 3) Rulesets (en repositorios privados requieren un plan de GitHub que los incluya: D-24).
for (const f of [".github/rulesets/main.json", ".github/rulesets/tags.json"]) {
  run("gh", ["api", "-X", "POST", `repos/${repo}/rulesets`, "--input", "-"], readFileSync(f, "utf8"));
}

// 4) Entornos: production solo con aprobación del propietario, sin bypass de administradores y solo desde main.
const ownerId = execute ? run("gh", ["api", `users/${owner}`, "--jq", ".id"]).trim() : "<id>";
const envBody = (reviewers) => JSON.stringify({
  wait_timer: 0,
  prevent_self_review: false,
  reviewers: reviewers ? [{ type: "User", id: Number(ownerId) || 0 }] : [],
  // Sin esto GitHub deja que un administrador despliegue a production sin la aprobación (ADR 0306).
  ...(reviewers ? { can_admins_bypass: false } : {}),
  deployment_branch_policy: { protected_branches: true, custom_branch_policies: false },
});
run("gh", ["api", "-X", "PUT", `repos/${repo}/environments/staging`, "--input", "-"], envBody(false));
run("gh", ["api", "-X", "PUT", `repos/${repo}/environments/production`, "--input", "-"], envBody(true));

// 5) Variables no secretas de Actions (salidas de `tofu output -json` de cada entorno).
const outputsPath = opt("outputs");
if (onlyRules) {
  console.log("[omitido] variables de Actions (--only rules).");
} else if (outputsPath && existsSync(outputsPath)) {
  const o = JSON.parse(readFileSync(outputsPath, "utf8"));
  const v = (env, k) => o[env]?.[k]?.value;
  const repoVars = { GCP_STAGING_REGISTRY: v("staging", "registry"), GCP_PRODUCTION_REGISTRY: v("production", "registry"), GCP_WIF_PROVIDER: v("staging", "wif_provider"), GCP_CI_SERVICE_ACCOUNT: v("staging", "ci_service_account") };
  for (const [k, val] of Object.entries(repoVars)) if (val) run("gh", ["variable", "set", k, "--repo", repo, "--body", val]);
  for (const env of ["staging", "production"]) {
    const envVars = { GCP_WIF_PROVIDER: v(env, "wif_provider"), GCP_DEPLOY_SERVICE_ACCOUNT: v(env, "deploy_service_account"), API_URL: v(env, "api_uri"), DELIVERY_STATE_BUCKET: v(env, "state_bucket"), GCP_PROJECT: v(env, "project_id"), GCP_REGION: v(env, "region") };
    for (const [k, val] of Object.entries(envVars)) if (val) run("gh", ["variable", "set", k, "--repo", repo, "--env", env, "--body", val]);
  }
} else {
  console.log("[pendiente] variables de Actions: se cargan con --outputs cuando existan los proyectos (D-18).");
}
console.log(execute ? "✓ repositorio conectado" : "Nada se ejecutó. Repite con --execute cuando el repositorio exista y el propietario lo autorice.");
