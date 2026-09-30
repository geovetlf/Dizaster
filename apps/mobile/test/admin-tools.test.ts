import { describe, expect, it } from "vitest";
import { parseDelayMinutes, parseSubjectRefs, dueFromDays, parseScopeList, parseUsd, shortId } from "../src/lib/admin/admin-tools";

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

describe("parseDelayMinutes (ADR 0109)", () => {
  it("acepta enteros de 0 a 1440", () => {
    expect(parseDelayMinutes(" 5 ")).toBe(5);
    expect(parseDelayMinutes("0")).toBe(0);
    expect(parseDelayMinutes("1440")).toBe(1440);
  });
  it("rechaza lo demás", () => {
    for (const bad of ["", "1441", "-1", "2.5", "abc", "12345"]) expect(parseDelayMinutes(bad)).toBeNull();
  });
});

describe("requerimientos de autoridades (ADR 0139)", () => {
  const id = "0b3c2a8e-8f1e-4c5b-9a7d-1234567890ab";
  it("solo acepta referencias internas", () => {
    expect(parseSubjectRefs(`user:${id}, POST:${id.toUpperCase()} Juan +51999`)).toEqual({ values: [`user:${id}`, `post:${id}`], invalid: ["juan", "+51999"] });
    expect(parseSubjectRefs(" ")).toEqual({ values: [], invalid: [] });
  });
  it("convierte el plazo en días", () => {
    const now = new Date("2026-09-29T12:00:00Z");
    expect(dueFromDays("", now)).toBeNull();
    expect(dueFromDays("10", now)).toBe("2026-10-09T12:00:00.000Z");
    for (const bad of ["0", "366", "2.5", "x"]) expect(dueFromDays(bad, now)).toBe("invalid");
  });
});

describe("historial de configuración (ADR 0219)", () => {
  it("valores legibles en una línea", async () => {
    const { configValue } = await import("../src/lib/admin/config-history");
    expect(configValue(null)).toBe("—");
    expect(configValue({ period: "DAILY", limitUsd: 8 })).toBe("period: DAILY · limitUsd: 8");
    expect(configValue({ categories: ["fire", "flood"], countries: ["PE"] })).toBe("categories: fire, flood · countries: PE");
  });
});
