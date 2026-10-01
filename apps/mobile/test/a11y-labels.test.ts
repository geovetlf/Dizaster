import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Lector de pantalla (ADR 0198): todo campo de texto tiene nombre accesible (el placeholder no basta: desaparece
// al escribir y VoiceOver/TalkBack no siempre lo leen). NO AI REQUIRED.
const SRC = new URL("../src/", import.meta.url).pathname;
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? files(p) : p.endsWith(".tsx") ? [p] : [];
});

describe("accesibilidad", () => {
  it("cada <TextInput> tiene accessibilityLabel", () => {
    const missing: string[] = [];
    for (const f of files(SRC)) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/<TextInput\b([\s\S]*?)\/>/g)) {
        if (!m[1]!.includes("accessibilityLabel")) missing.push(`${f.slice(SRC.length)}:${src.slice(0, m.index).split("\n").length}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("ninguna etiqueta accesible escrita a mano fuera de las traducciones", () => {
    const hard: string[] = [];
    for (const f of files(SRC)) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/accessibilityLabel="([^"]*)"/g)) hard.push(`${f.slice(SRC.length)}: ${m[1]}`);
    }
    expect(hard).toEqual([]);
  });

  it("los errores en línea se anuncian con ErrorText, no con un <Text> mudo (ADR 0292)", () => {
    const mute: string[] = [];
    for (const f of files(SRC)) {
      const src = readFileSync(f, "utf8");
      // Un <Text> con estilo de error, o que pinta directamente la variable `error`, debería ser <ErrorText> (ADR 0300).
      const patterns = [/<Text style=\{(?:styles\.error|error \? styles\.error[^}]*)\}>/g, /<Text[^>]*>\{error\}<\/Text>/g, /\{error \?\? /g];
      for (const re of patterns) {
        for (const m of src.matchAll(re)) mute.push(`${f.slice(SRC.length)}:${src.slice(0, m.index).split("\n").length}`);
      }
    }
    expect(mute).toEqual([]);
  });
});
