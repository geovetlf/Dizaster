import { describe, expect, it } from "vitest";
import { AA_NON_TEXT, AA_TEXT, contrastRatio } from "../src/lib/a11y/contrast";
import { colors } from "../src/theme";

// Contraste del tema (ADR 0199, WCAG AA). NO AI REQUIRED.
const backgrounds = { bg: colors.bg, surface: colors.surface, surfaceAlt: colors.surfaceAlt, accentSoft: colors.accentSoft };

describe("contraste del tema", () => {
  it("fórmula WCAG: blanco sobre negro es 21:1", () => {
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 5);
  });

  it.each(["text", "textMuted", "link", "accentText"] as const)("texto %s cumple AA en todos los fondos", (fg) => {
    for (const [name, bg] of Object.entries(backgrounds)) {
      expect(contrastRatio(colors[fg], bg), `${fg} sobre ${name}`).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it("el acento (iconos, bordes, fondos de botón) cumple AA de elementos no textuales", () => {
    for (const bg of [colors.bg, colors.surface, colors.surfaceAlt]) expect(contrastRatio(colors.accent, bg)).toBeGreaterThanOrEqual(AA_NON_TEXT);
    // Texto blanco sobre botón rojo.
    expect(contrastRatio(colors.white, colors.accent)).toBeGreaterThanOrEqual(AA_TEXT);
  });
});
