import { describe, expect, it } from "vitest";
import { canStateOn } from "../src/lib/social/business";

const scope = { categories: ["fire", "natural.flood"], countries: ["PE"], active: true };
const ev = (categoryCode: string, countryCode: string | null = "PE", status = "ACTIVE") => ({ categoryCode, countryCode, status });

describe("canStateOn", () => {
  it("acepta categorías del ámbito y sus hijas en sus países", () => {
    expect(canStateOn(scope, ev("fire.structure"))).toBe(true);
    expect(canStateOn(scope, ev("natural.flood"))).toBe(true);
    expect(canStateOn(scope, ev("fire", "PE", "MONITORING"))).toBe(true);
  });
  it("rechaza fuera de ámbito, sin país, cerrado o sin ámbito activo", () => {
    expect(canStateOn(scope, ev("natural.earthquake"))).toBe(false);
    expect(canStateOn(scope, ev("firework"))).toBe(false);
    expect(canStateOn(scope, ev("fire.structure", "CL"))).toBe(false);
    expect(canStateOn(scope, ev("fire.structure", null))).toBe(false);
    expect(canStateOn(scope, ev("fire.structure", "PE", "RESOLVED"))).toBe(false);
    expect(canStateOn({ ...scope, active: false }, ev("fire.structure"))).toBe(false);
    expect(canStateOn(null, ev("fire.structure"))).toBe(false);
  });
});
