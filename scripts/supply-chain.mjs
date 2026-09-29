#!/usr/bin/env node
// Cadena de suministro (ADR 0070): licencias permitidas, avisos de seguridad y SBOM CycloneDX, sin servicios de pago.
//   node scripts/supply-chain.mjs licenses        → falla si una dependencia de producción tiene licencia no permitida
//   node scripts/supply-chain.mjs audit           → falla con avisos high/critical no aceptados (security/audit-allowlist.json)
//   node scripts/supply-chain.mjs sbom <archivo>  → escribe un SBOM CycloneDX 1.5 (JSON)
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const readJson = (p) => JSON.parse(readFileSync(new URL(p, root), "utf8"));
const pnpm = (args) => execFileSync("pnpm", args, { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });

/** "(MIT OR Apache-2.0)" vale si alguna opción está permitida; "A AND B" si todas lo están. */
export function licenseAllowed(expr, allowed) {
  const e = expr.trim().replace(/^\((.*)\)$/, "$1");
  if (/\sOR\s/.test(e)) return e.split(/\s+OR\s+/).some((x) => licenseAllowed(x, allowed));
  if (/\sAND\s/.test(e)) return e.split(/\s+AND\s+/).every((x) => licenseAllowed(x, allowed));
  return allowed.includes(e);
}

const glob = (pattern, name) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`).test(name);

function packages() {
  const byLicense = JSON.parse(pnpm(["licenses", "list", "--json", "--prod"]));
  return Object.entries(byLicense).flatMap(([license, list]) => list.map((p) => ({ name: p.name, versions: p.versions, license })));
}

function licenses() {
  const policy = readJson("security/license-policy.json");
  const bad = packages().filter((p) => !licenseAllowed(p.license, policy.allowed)
    && !policy.exceptions.some((x) => glob(x.package, p.name) && x.license === p.license));
  if (bad.length) {
    console.error("Licencias no permitidas en producción:");
    for (const p of bad) console.error(`  ${p.name}@${p.versions.join(",")}: ${p.license}`);
    process.exit(1);
  }
  console.log("Licencias: OK");
}

function audit() {
  let raw;
  try { raw = pnpm(["audit", "--prod", "--json"]); } catch (e) { raw = e.stdout; } // pnpm audit sale con 1 si hay avisos
  const report = JSON.parse(raw);
  const allow = readJson("security/audit-allowlist.json").advisories;
  const today = new Date().toISOString().slice(0, 10);
  const accepted = new Set(allow.filter((a) => a.reviewBy >= today).map((a) => String(a.id)));
  const blocking = Object.entries(report.advisories ?? {})
    .filter(([id, a]) => (a.severity === "high" || a.severity === "critical") && !accepted.has(id));
  const counts = report.metadata?.vulnerabilities ?? {};
  console.log(`Avisos: ${JSON.stringify(counts)}`);
  if (blocking.length) {
    for (const [id, a] of blocking) console.error(`  ${a.severity} ${id} ${a.module_name} ${a.vulnerable_versions}: ${a.title}`);
    process.exit(1);
  }
  console.log("Auditoría: sin avisos high/critical pendientes");
}

function sbom(out) {
  const version = readJson("package.json").version ?? "0.0.0";
  const components = packages().flatMap((p) => p.versions.map((v) => ({
    type: "library", name: p.name, version: v, purl: `pkg:npm/${p.name.replace(/^@/, "%40")}@${v}`,
    licenses: [{ expression: p.license }],
  })));
  const doc = {
    bomFormat: "CycloneDX", specVersion: "1.5", version: 1,
    metadata: { timestamp: new Date().toISOString(), component: { type: "application", name: "dizaster", version } },
    components,
  };
  writeFileSync(out, JSON.stringify(doc, null, 1));
  console.log(`SBOM: ${components.length} componentes → ${out}`);
}

const [cmd, arg] = process.argv.slice(2);
if (import.meta.url === `file://${process.argv[1]}`) {
  if (cmd === "licenses") licenses();
  else if (cmd === "audit") audit();
  else if (cmd === "sbom") sbom(arg ?? "sbom.cdx.json");
  else { console.error("uso: supply-chain.mjs licenses | audit | sbom <archivo>"); process.exit(2); }
}
