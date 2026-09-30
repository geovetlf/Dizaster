import { describe, expect, it } from "vitest";
import { clusterZoom, mapListOrder } from "../src/lib/map/event-style";

// Mapa accesible (ADR 0200). NO AI REQUIRED.
describe("mapa accesible", () => {
  it("tocar un grupo acerca dos niveles, con mínimo 6 y máximo 16", () => {
    expect(clusterZoom(3)).toBe(6);
    expect(clusterZoom(9)).toBe(11);
    expect(clusterZoom(15.5)).toBe(16);
  });

  it("lista: lo más grave primero, luego lo oficial, luego lo más reciente", () => {
    const e = (id: string, severity: number, publicVerificationState: "OFFICIALLY_CONFIRMED" | "UNVERIFIED", lastActivityAt: string) =>
      ({ id, severity, publicVerificationState, lastActivityAt });
    const out = mapListOrder([
      e("a", 3, "UNVERIFIED", "2026-09-30T10:00:00Z"),
      e("b", 5, "UNVERIFIED", "2026-09-30T09:00:00Z"),
      e("c", 3, "OFFICIALLY_CONFIRMED", "2026-09-30T08:00:00Z"),
      e("d", 3, "UNVERIFIED", "2026-09-30T11:00:00Z"),
    ]);
    expect(out.map((x) => x.id)).toEqual(["b", "c", "d", "a"]);
  });
});
