import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// El teclado nunca tapa un campo de texto (RF-01, ADR 0271). Android encoge la ventana (softwareKeyboardLayoutMode
// "resize"); iOS no lo hace solo: cada pantalla con TextInput desplaza su contenido con
// automaticallyAdjustKeyboardInsets o usa KeyboardAvoidingView.
const src = join(__dirname, "..", "src");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : /\.tsx$/.test(f) ? [join(dir, f)] : []));

describe("teclado en iOS y Android", () => {
  it("Android redimensiona la ventana con el teclado", () => {
    expect(readFileSync(join(__dirname, "..", "app.config.ts"), "utf8")).toMatch(/softwareKeyboardLayoutMode: "resize"/);
  });

  it("toda pantalla con campos de texto se ajusta al teclado en iOS", () => {
    const screens = files(join(src, "app")).filter((f) => readFileSync(f, "utf8").includes("<TextInput"));
    expect(screens.length).toBeGreaterThan(20);
    const missing = screens.filter((f) => {
      const s = readFileSync(f, "utf8");
      return !/<(ScrollView|FlatList|SectionList) automaticallyAdjustKeyboardInsets/.test(s) && !s.includes("<KeyboardAvoidingView");
    });
    expect(missing).toEqual([]);
  });

  it("una lista dentro de KeyboardAvoidingView no se ajusta dos veces", () => {
    for (const f of files(src)) {
      const s = readFileSync(f, "utf8");
      if (s.includes("<KeyboardAvoidingView")) expect(s, f).not.toContain("automaticallyAdjustKeyboardInsets");
    }
  });
});
