import { describe, expect, it } from "vitest";
import { updateRequirement } from "../src/lib/app-update";

describe("versión mínima (ADR 0164)", () => {
  const cfg = { appUpdate: { android: { minVersion: "1.4.0", storeUrl: "https://play.example/app" }, ios: { minVersion: null, storeUrl: null } } };
  it("pide actualizar solo por debajo del mínimo de su plataforma", () => {
    expect(updateRequirement(cfg, "android", "1.3.9")).toEqual({ required: true, storeUrl: "https://play.example/app" });
    expect(updateRequirement(cfg, "android", "1.4.0").required).toBe(false);
    expect(updateRequirement(cfg, "ios", "0.1.0").required).toBe(false);
  });
  it("sin datos nunca bloquea", () => {
    expect(updateRequirement(null, "android", "0.0.1").required).toBe(false);
    expect(updateRequirement(cfg, "android", null).required).toBe(false);
    expect(updateRequirement(cfg, "web", "0.0.1").required).toBe(false);
    // Un servidor antiguo sin el campo.
    expect(updateRequirement({} as never, "android", "0.0.1").required).toBe(false);
  });
});
