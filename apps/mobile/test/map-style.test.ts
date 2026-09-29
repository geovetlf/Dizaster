import { PublicVerificationState } from "@dizaster/contracts";
import { describe, expect, it } from "vitest";
import { VERIFICATION_STROKE, mapFilterQuery, nextMapWindow, pointOpacity } from "../src/lib/map/event-style";

describe("estilo y filtros del mapa (ADR 0057)", () => {
  it("cubre todos los estados y resalta lo confirmado", () => {
    for (const s of PublicVerificationState.options) expect(VERIFICATION_STROKE[s]).toBeDefined();
    expect(VERIFICATION_STROKE.OFFICIALLY_CONFIRMED.width).toBeGreaterThan(VERIFICATION_STROKE.UNVERIFIED.width);
    expect(VERIFICATION_STROKE.DISPUTED.opacity).toBeLessThan(1);
  });
  it("lo resuelto se ve más tenue", () => {
    expect(pointOpacity("OFFICIALLY_CONFIRMED", "RESOLVED")).toBeLessThan(pointOpacity("OFFICIALLY_CONFIRMED", "ACTIVE"));
  });
  it("arma la query solo con lo que filtra", () => {
    expect(mapFilterQuery({ category: null, verifiedOnly: false })).toBe("");
    expect(mapFilterQuery({ category: "fire", verifiedOnly: true })).toBe("&categories=fire&verified=1");
    // Ventana de tiempo (ADR 0123): fija para que la CDN comparta la tesela.
    expect(mapFilterQuery({ category: null, verifiedOnly: false, window: "24h" })).toBe("&window=24h");
    expect([nextMapWindow(null), nextMapWindow("24h"), nextMapWindow("6h"), nextMapWindow("7d")]).toEqual(["24h", "6h", "7d", null]);
  });
});
