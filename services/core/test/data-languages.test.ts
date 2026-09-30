import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Todo texto localizado de data/ trae los 4 idiomas de la app (ADR 0202, §5.15): quien usa la app en portugués o
// francés no ve un nombre genérico o en otro idioma porque faltó una traducción en los datos. NO AI REQUIRED.
const DATA = new URL("../../../data/", import.meta.url).pathname;
const APP_LANGS = ["es", "en", "pt", "fr"];
const KNOWN = new Set([...APP_LANGS, "qu", "ay"]);

const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? files(p) : p.endsWith(".json") ? [p] : [];
});

function walk(x: unknown, path: string, out: string[]): void {
  if (Array.isArray(x)) return x.forEach((v, i) => walk(v, `${path}[${i}]`, out));
  if (!x || typeof x !== "object") return;
  const keys = Object.keys(x);
  const texts = Object.values(x).every((v) => typeof v === "string");
  if (keys.length > 0 && keys.includes("es") && texts && keys.every((k) => KNOWN.has(k))) {
    const missing = APP_LANGS.filter((l) => typeof (x as Record<string, unknown>)[l] !== "string");
    if (missing.length) out.push(`${path} sin ${missing.join(",")}`);
    return;
  }
  for (const [k, v] of Object.entries(x)) walk(v, `${path}.${k}`, out);
}

describe("idiomas en data/", () => {
  it("cada texto localizado tiene es, en, pt y fr", () => {
    const problems: string[] = [];
    for (const f of files(DATA)) walk(JSON.parse(readFileSync(f, "utf8")), f.slice(DATA.length), problems);
    expect(problems).toEqual([]);
  });
});
