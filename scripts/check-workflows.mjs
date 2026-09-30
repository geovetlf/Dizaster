#!/usr/bin/env node
// Endurecimiento de GitHub Actions (ADR 0264, Blueprint §20.7). Sin red ni dependencias:
// - cada workflow declara `permissions:` en la raíz (mínimo privilegio del GITHUB_TOKEN);
// - cada `uses:` externo está fijado por SHA de 40 caracteres (una etiqueta se puede mover);
// - ninguna herramienta se ejecuta con `@latest`.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = ".github/workflows";
const problems = [];
for (const name of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
  const text = readFileSync(join(dir, name), "utf8");
  if (!/^permissions:/m.test(text)) problems.push(`${name}: falta \`permissions:\` en la raíz`);
  for (const [i, line] of text.split("\n").entries()) {
    const use = /^\s*-?\s*uses:\s*([^\s#]+)/.exec(line)?.[1];
    if (use && !use.startsWith("./") && !/@[0-9a-f]{40}$/.test(use)) problems.push(`${name}:${i + 1}: \`${use}\` no está fijado por SHA`);
    if (/@latest\b/.test(line)) problems.push(`${name}:${i + 1}: versión \`@latest\``);
  }
}
if (problems.length) {
  console.error(`Workflows sin endurecer (ADR 0264):\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  process.exit(1);
}
console.log("workflows OK");
