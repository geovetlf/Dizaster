import { PublicVerificationState } from "@dizaster/contracts";
import { describe, expect, it } from "vitest";
import { VERIFICATION_STROKE, mapFilterQuery } from "../src/lib/map/event-style";

describe("estilo y filtros del mapa (ADR 0057)", () => {
  it("cubre todos los estados y resalta lo confirmado", () => {
    for (const s of PublicVerificationState.options) expect(VERIFICATION_STROKE[s]).toBeDefined();
    expect(VERIFICATION_STROKE.OFFICIALLY_CONFIRMED.width).toBeGreaterThan(VERIFICATION_STROKE.UNVERIFIED.width);
    expect(VERIFICATION_STROKE.DISPUTED.opacity).toBeLessThan(1);
  });
  it("arma la query solo con lo que filtra", () => {
    expect(mapFilterQuery({ category: null, verifiedOnly: false })).toBe("");
    expect(mapFilterQuery({ category: "fire", verifiedOnly: true })).toBe("&categories=fire&verified=1");
  });
});
