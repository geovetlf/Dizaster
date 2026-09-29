import { describe, expect, it } from "vitest";
import { ADS_ENABLED_V1, adPlacementAllowed, adPlacementDenials } from "../src/index.js";

// Reglas de exclusión de publicidad (§5.16, C-09, D-14; ADR 0126).
describe("publicidad", () => {
  const ok = { surface: "FEED" as const, targeting: "REGION" as const, labeled: true, evaluateEvenIfDisabled: true };

  it("V1 no tiene anuncios", () => {
    expect(ADS_ENABLED_V1).toBe(false);
    expect(adPlacementDenials({ surface: "FEED", targeting: "NONE", labeled: true })).toEqual(["ADS_DISABLED_V1"]);
  });

  it("nunca en alertas, emergencia ni reportes", () => {
    for (const surface of ["ALERT", "EMERGENCY", "REPORT"] as const) {
      expect(adPlacementDenials({ ...ok, surface })).toContain("FORBIDDEN_SURFACE");
    }
    expect(adPlacementAllowed(ok)).toBe(true);
  });

  it("nunca junto a eventos graves o sensibles, ni sobre un evento activo en el mapa", () => {
    const event = { severity: 4, status: "ACTIVE", sensitivity: "NORMAL" as const };
    expect(adPlacementDenials({ ...ok, surface: "EVENT", event })).toEqual(["HIGH_SEVERITY_EVENT"]);
    expect(adPlacementDenials({ ...ok, surface: "EVENT", event: { ...event, severity: 2, sensitivity: "HIGHLY_SENSITIVE" } })).toEqual(["SENSITIVE_EVENT"]);
    expect(adPlacementDenials({ ...ok, surface: "MAP", event: { ...event, severity: 2 } })).toEqual(["ACTIVE_EMERGENCY_EVENT"]);
    expect(adPlacementAllowed({ ...ok, surface: "EVENT", event: { severity: 2, status: "RESOLVED", sensitivity: "NORMAL" } })).toBe(true);
  });

  it("sin segmentación más fina que región y siempre marcado", () => {
    for (const targeting of ["CITY", "ZONE", "PRECISE"] as const) expect(adPlacementDenials({ ...ok, targeting })).toEqual(["PRECISE_TARGETING"]);
    expect(adPlacementDenials({ ...ok, labeled: false })).toEqual(["NOT_LABELED"]);
  });
});
