import { describe, expect, it } from "vitest";
import { SubmitReportRequest, publicVerificationState, CategoryCode, langFromLocale } from "../src/index.js";

const base = {
  clientReportId: "01928c1e-7b1a-7cc0-8a9e-2c4f5d6e7f80",
  categoryCode: "accident.traffic",
  pin: { lat: -12.05, lng: -77.04 },
  presence: {
    fix: { lat: -12.05, lng: -77.04, accuracyM: 8, fixTime: "2026-09-29T10:00:00Z" },
    mockLocation: false,
    attestationToken: null,
    deviceClock: "2026-09-29T10:00:05Z",
  },
  capturedAt: "2026-09-29T10:00:00Z",
};

describe("contracts", () => {
  it("acepta un reporte válido y aplica valores por defecto", () => {
    const r = SubmitReportRequest.parse(base);
    expect(r.assertion).toBe("OCCURRING");
    expect(r.anonymityMode).toBe("PUBLIC");
  });

  it("exige targetEventId para contra-reportes", () => {
    expect(SubmitReportRequest.safeParse({ ...base, assertion: "NOT_OCCURRING" }).success).toBe(false);
  });

  it("rechaza coordenadas fuera de rango", () => {
    expect(SubmitReportRequest.safeParse({ ...base, pin: { lat: 91, lng: 0 } }).success).toBe(false);
  });

  it("los estados negativos tienen prioridad en el estado público", () => {
    expect(publicVerificationState("OFFICIALLY_CONFIRMED", "FALSE")).toBe("FALSE");
    expect(publicVerificationState("COMMUNITY_CORROBORATED", "DISPUTED")).toBe("DISPUTED");
    expect(publicVerificationState("UNVERIFIED", "NONE")).toBe("UNVERIFIED");
  });

  it("valida códigos de categoría jerárquicos", () => {
    expect(CategoryCode.safeParse("fire.wildfire").success).toBe(true);
    expect(CategoryCode.safeParse("Fire Wildfire").success).toBe(false);
  });
});

describe("idiomas", () => {
  it("elige el idioma soportado a partir del locale del teléfono", () => {
    expect(langFromLocale("pt-BR")).toBe("pt");
    expect(langFromLocale("fr_CA")).toBe("fr");
    expect(langFromLocale("en-US")).toBe("en");
    expect(langFromLocale("de-DE")).toBe("es");
    expect(langFromLocale(null)).toBe("es");
  });
});
