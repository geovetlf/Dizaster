// Verifica las fronteras del monolito modular (Blueprint §3 y §18):
// 1. Un módulo solo importa de otro a través de su index público.
// 2. Un módulo solo escribe/lee SQL de su propio esquema (más platform.outbox vía helpers).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const modulesDir = new URL("../services/core/src/modules/", import.meta.url).pathname;
const SCHEMA_BY_MODULE = {
  identity: ["identity"], social: ["social"], report: ["report"], event: ["event"], verification: ["verification"],
  ingestion: ["ingestion"], media: ["media"], geo: ["geo"], reference: [], feed: [], alert: ["alert"], cost: ["cost"], moderation: ["moderation"], trust: ["trust"],
};
const ALL_SCHEMAS = ["identity", "social", "report", "event", "verification", "ingestion", "media", "geo", "alert", "cost", "moderation", "trust"];
const errors = [];

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });
}

for (const mod of readdirSync(modulesDir)) {
  const own = SCHEMA_BY_MODULE[mod];
  if (!own) { errors.push(`Módulo sin esquema declarado en check-module-boundaries: ${mod}`); continue; }
  for (const file of walk(join(modulesDir, mod))) {
    const src = readFileSync(file, "utf8");
    const rel = relative(modulesDir, file);
    for (const m of src.matchAll(/from\s+"\.\.\/([a-z-]+)\/([^"]+)"/g)) {
      if (m[2] !== "index.js") errors.push(`${rel}: importa ${m[1]}/${m[2]} (solo se permite ../${m[1]}/index.js)`);
    }
    for (const schema of ALL_SCHEMAS) {
      if (own.includes(schema)) continue;
      const re = new RegExp(`\\b(FROM|JOIN|INTO|UPDATE)\\s+${schema}\\.`, "g");
      if (re.test(src)) errors.push(`${rel}: accede al esquema "${schema}" que pertenece a otro módulo`);
    }
  }
}

if (errors.length) {
  console.error("Violaciones de fronteras de módulo:\n" + errors.map((e) => ` - ${e}`).join("\n"));
  process.exit(1);
}
console.log("Fronteras de módulo: OK");
