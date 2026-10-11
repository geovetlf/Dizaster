import { describe, expect, it } from "vitest";
import { tf } from "../src/lib/i18n";
import { corroboratedLine } from "../src/lib/social/corroborated";

describe("«N reportes corroborados» en el perfil (D3, ADR 0321)", () => {
  const fake = (k: string, p: { n: number }) => `${k}:${p.n}`;

  it("nada si se ocultó o si aún no hay ninguno", () => {
    expect(corroboratedLine(null, fake)).toBeNull();
    expect(corroboratedLine(undefined, fake)).toBeNull();
    expect(corroboratedLine({ total: 0, official: 0 }, fake)).toBeNull();
  });

  it("la confirmación oficial va aparte de la corroboración", () => {
    expect(corroboratedLine({ total: 4, official: 0 }, fake)).toBe("corroboratedReports:4");
    expect(corroboratedLine({ total: 4, official: 1 }, fake)).toBe("corroboratedReports:4 · corroboratedOfficial:1");
  });

  it("con los textos reales, en singular y plural", () => {
    expect(corroboratedLine({ total: 1, official: 0 }, tf)).toMatch(/1/);
    expect(corroboratedLine({ total: 12, official: 3 }, tf)).toMatch(/12.*·.*3/);
  });
});
