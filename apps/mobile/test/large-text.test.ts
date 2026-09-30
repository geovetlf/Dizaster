import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// ADR 0240: con texto grande del sistema, SOS y el contador no se cortan y los botones pequeños se pueden tocar.
const read = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
describe("texto grande y zonas táctiles", () => {
  it("los botones de la cabecera crecen con el texto y SOS tiene tope de escala", () => {
    const s = read("components/home/header.tsx");
    expect(s).toContain("iconButton: { minWidth: 44, minHeight: 44");
    expect(s).not.toMatch(/iconButton: \{ width: 44, height: 44/);
    expect(s).toMatch(/sosText\} maxFontSizeMultiplier=/);
    expect(s).toMatch(/badgeText\} maxFontSizeMultiplier=/);
  });
  it("los botones de 24 px de los adjuntos llegan a 44 px con hitSlop", () => {
    const s = read("components/media-attachments.tsx");
    expect(s.match(/hitSlop=\{10\} style=\{\[?styles\.(remove|graphic)/g)).toHaveLength(2);
  });
});
