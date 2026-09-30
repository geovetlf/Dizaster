#!/usr/bin/env node
// Revisa que ningún archivo versionado contenga credenciales ni archivos de firma (ADR 0218). Sin red ni dependencias.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const forbiddenFiles = /(\.(jks|keystore|p8|p12|pem|key|mobileprovision)$|(^|\/)google-services\.json$|GoogleService-Info\.plist$|(^|\/)\.env$|service-account.*\.json$)/i;
const patterns = [
  ["clave privada", /-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/],
  ["clave de acceso AWS", /\bAKIA[0-9A-Z]{16}\b/],
  ["clave de API de Google", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["token de GitHub", /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ["clave de API tipo sk-", /\bsk-(proj-|ant-)?[A-Za-z0-9_-]{24,}\b/],
  ["token de Expo", /\bEXPO_TOKEN\s*=\s*[A-Za-z0-9_-]{20,}/],
  ["token de Slack", /\bxox[abpr]-[A-Za-z0-9-]{10,}/],
];
// Ejemplos públicos de la documentación de AWS usados en pruebas.
const allowed = ["AKIAIOSFODNN7EXAMPLE"];

const problems = [];
for (const f of files) {
  if (forbiddenFiles.test(f)) problems.push(`${f}: archivo de credenciales versionado`);
  let text;
  try {
    if (statSync(f).size > 2_000_000) continue;
    text = readFileSync(f, "utf8");
  } catch { continue; }
  for (const [name, re] of patterns) {
    const m = re.exec(text);
    if (m && !allowed.includes(m[0])) problems.push(`${f}: posible ${name}`);
  }
}
if (problems.length) {
  console.error(`Posibles secretos en el repositorio:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  process.exit(1);
}
console.log(`check:secrets ok (${files.length} archivos)`);
