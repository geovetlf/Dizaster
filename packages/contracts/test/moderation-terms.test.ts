import { describe, expect, it } from "vitest";
import { compileTerms, matchTerms, normalizeForTerms, ModerationTermList } from "../src/index.js";

describe("listas de términos (ADR 0148)", () => {
  it("vacías: nunca coinciden", () => {
    expect(matchTerms("cualquier cosa", compileTerms({ version: "x", languages: { es: [] } }))).toEqual([]);
  });
  it("palabra o frase completa, sin mayúsculas ni tildes", () => {
    const c = compileTerms({ version: "x", languages: { es: [{ term: "Término Prueba", reason: "HARASSMENT" }], en: [{ term: "zzz", reason: "SPAM" }] } });
    expect(matchTerms("un TERMINO   prueba aquí", c)).toEqual([{ term: "Término Prueba", reason: "HARASSMENT" }]);
    expect(matchTerms("subtérmino pruebas", c)).toEqual([]);
    expect(matchTerms("zzz!", c)).toEqual([{ term: "zzz", reason: "SPAM" }]);
    expect(normalizeForTerms("¡Ñandú, ÁRBOL!")).toBe(" nandu arbol ");
  });
  it("el archivo de datos es válido y está vacío", async () => {
    const { readFileSync } = await import("node:fs");
    const list = ModerationTermList.parse(JSON.parse(readFileSync(new URL("../../../data/moderation/terms.json", import.meta.url), "utf8")));
    expect(Object.values(list.languages).every((l) => l.length === 0)).toBe(true);
  });
});
