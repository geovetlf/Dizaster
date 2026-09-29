import { describe, expect, it } from "vitest";
import { parseScopeList, parseUsd, shortId } from "../src/lib/admin/admin-tools";

describe("parseUsd", () => {
  it("acepta montos con coma o $ y hasta 2 decimales", () => {
    expect(parseUsd("12,5")).toBe(12.5);
    expect(parseUsd("$ 40")).toBe(40);
    expect(parseUsd("0")).toBe(0);
    expect(parseUsd("1000000")).toBe(1_000_000);
  });
  it("rechaza negativos, texto, demasiados decimales o por encima del máximo", () => {
    for (const bad of ["-1", "abc", "", "1.234", "1000000.01", "1e3"]) expect(parseUsd(bad)).toBeNull();
  });
});

describe("parseScopeList", () => {
  it("normaliza países y categorías y separa lo inválido", () => {
    expect(parseScopeList("pe, cl  PE x1", "country")).toEqual({ values: ["PE", "CL"], invalid: ["X1"] });
    expect(parseScopeList("Fire, natural.flood natural..x", "category")).toEqual({ values: ["fire", "natural.flood"], invalid: ["natural..x"] });
    expect(parseScopeList("  ", "country")).toEqual({ values: [], invalid: [] });
  });
  it("shortId recorta a 8", () => {
    expect(shortId("0123456789abcdef")).toBe("01234567");
  });
});
