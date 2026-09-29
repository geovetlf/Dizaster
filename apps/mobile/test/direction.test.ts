import { SUPPORTED_LANGS } from "@dizaster/contracts";
import { describe, expect, it } from "vitest";
import { directionFor, forwardChevron, isRtlLang } from "../src/lib/ui/direction";

describe("dirección de escritura (ADR 0102)", () => {
  it("reconoce idiomas RTL por su código base", () => {
    expect(isRtlLang("ar")).toBe(true);
    expect(isRtlLang("he-IL")).toBe(true);
    expect(isRtlLang("fa_IR")).toBe(true);
    expect(isRtlLang("es-PE")).toBe(false);
    for (const l of SUPPORTED_LANGS) expect(isRtlLang(l)).toBe(false);
  });
  it("la dirección sigue al idioma de la app: un teléfono RTL con la app en español vuelve a LTR tras reiniciar", () => {
    expect(directionFor("es", true)).toEqual({ rtl: false, needsRestart: true });
    expect(directionFor("es", false)).toEqual({ rtl: false, needsRestart: false });
    expect(directionFor("ar", false)).toEqual({ rtl: true, needsRestart: true });
  });
  it("el icono de avance apunta al final de la línea", () => {
    expect(forwardChevron(false)).toBe("chevron-right");
    expect(forwardChevron(true)).toBe("chevron-left");
  });
});

describe("estilos sin márgenes físicos (ADR 0102)", () => {
  it("ningún componente usa marginLeft/Right ni paddingLeft/Right: se usan start/end", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith(".tsx") ? [p] : [];
    });
    const offenders = walk(new URL("../src", import.meta.url).pathname)
      .filter((f) => /\b(margin|padding)(Left|Right)\b/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
