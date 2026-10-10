#!/usr/bin/env node
// Endurecimiento de GitHub Actions (ADR 0264, Blueprint §20.7). Sin red ni dependencias:
// - cada workflow declara `permissions:` en la raíz (mínimo privilegio del GITHUB_TOKEN);
// - cada `uses:` externo está fijado por SHA de 40 caracteres (una etiqueta se puede mover);
// - ninguna herramienta se ejecuta con `@latest`;
// - toda imagen de `docker run` va fijada por digest (ADR 0266);
// - Node y PostgreSQL usan la misma versión mayor en todas partes, y Dependabot vigila cada raíz de OpenTofu (ADR 0308).
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
  // Un `run: >-` parte el comando en varias líneas: la imagen se busca en el texto plegado de cada paso.
  for (const step of text.split(/\n\s*- (?=name:|uses:|run:)/)) {
    const flat = step.replace(/\s*\n\s*/g, " ");
    for (const m of flat.matchAll(/docker run\b((?:\s+(?:-[-\w]+(?:[ =](?:"[^"]*"|[^\s-]\S*))?))*)\s+([^\s-][^\s]*)/g)) {
      if (!/@sha256:[0-9a-f]{64}$/.test(m[2])) problems.push(`${name}: la imagen \`${m[2]}\` de \`docker run\` no está fijada por digest`);
    }
  }
}
// Imágenes base de los Dockerfile fijadas por digest (ADR 0273).
for (const name of readdirSync("infra/docker").filter((f) => f.endsWith("Dockerfile"))) {
  for (const [i, line] of readFileSync(join("infra/docker", name), "utf8").split("\n").entries()) {
    const from = /^FROM\s+(\S+)/i.exec(line)?.[1];
    if (from && !/@sha256:[0-9a-f]{64}$/.test(from)) problems.push(`infra/docker/${name}:${i + 1}: \`${from}\` no está fijada por digest`);
  }
}
// Versiones mayores alineadas (ADR 0308): una actualización aislada (p. ej. un PR de Dependabot que solo cambia la
// imagen) deja CI en rojo hasta que se cambie todo junto y con su ADR.
const read = (f) => readFileSync(f, "utf8");
const node = read(".nvmrc").trim().split(".")[0];
const engines = /(\d+)/.exec(JSON.parse(read("package.json")).engines?.node ?? "")?.[1];
if (engines !== node) problems.push(`package.json engines.node (${engines}) no coincide con .nvmrc (${node})`);
for (const m of read("infra/docker/core.Dockerfile").matchAll(/^FROM\s+node:(\d+)/gim)) {
  if (m[1] !== node) problems.push(`infra/docker/core.Dockerfile usa node:${m[1]} y .nvmrc dice ${node}`);
}
const pg = /^FROM\s+postgis\/postgis:(\d+)-/im.exec(read("infra/docker/db.Dockerfile"))?.[1];
const pgCi = [...read(".github/workflows/ci.yml").matchAll(/postgresql-(\d+)/g)].map((m) => m[1]);
const pgCloudSql = /database_version\s*=\s*"POSTGRES_(\d+)"/.exec(read("infra/tofu/modules/database-cloudsql/main.tf"))?.[1];
for (const [where, v] of [...pgCi.map((v) => ["ci.yml", v]), ["database-cloudsql", pgCloudSql]]) {
  if (v !== pg) problems.push(`${where} usa PostgreSQL ${v} y infra/docker/db.Dockerfile usa ${pg}`);
}
// Cada raíz de OpenTofu (un main.tf con required_providers) figura en el bloque terraform de Dependabot.
const tofuRoots = [];
const walk = (d) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (e.isDirectory()) walk(join(d, e.name));
    else if (e.name === "main.tf" && /required_providers/.test(read(join(d, e.name)))) tofuRoots.push(`/${d}`);
  }
};
walk("infra/tofu");
const dependabot = read(".github/dependabot.yml");
const terraformDirs = /package-ecosystem:\s*terraform[\s\S]*?directories:\s*\[([^\]]*)\]/.exec(dependabot)?.[1].split(",").map((x) => x.trim()) ?? [];
for (const root of tofuRoots) if (!terraformDirs.includes(root)) problems.push(`.github/dependabot.yml: la raíz ${root} no está en terraform.directories`);

if (problems.length) {
  console.error(`Workflows sin endurecer o versiones desalineadas (ADR 0264, 0308):\n${[...new Set(problems)].map((p) => `  - ${p}`).join("\n")}`);
  process.exit(1);
}
console.log("workflows OK");
