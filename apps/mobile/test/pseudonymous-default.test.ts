import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pseudonymousByDefault } from "../src/lib/report/anonymity";

// §13.2 / D-05 (ADR 0234): reportes sensibles seudónimos por defecto; la persona puede cambiarlo.
describe("seudónimo por defecto en categorías sensibles", () => {
  it("encendido en sensibles y muy sensibles, apagado en normales", () => {
    expect(pseudonymousByDefault("NORMAL")).toBe(false);
    expect(pseudonymousByDefault("SENSITIVE")).toBe(true);
    expect(pseudonymousByDefault("HIGHLY_SENSITIVE")).toBe(true);
  });
  it("la pantalla lo aplica al elegir categoría y respeta el borrador retomado", () => {
    const s = readFileSync(new URL("../src/app/report.tsx", import.meta.url), "utf8");
    expect(s.match(/if \(!keepAnonymity\) setPseudonymous\(pseudonymousByDefault\(c\.sensitivity\)\)/g)).toHaveLength(2);
    expect(s).toContain("await choose(c, true)");
  });
});
