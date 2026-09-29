import { describe, expect, it } from "vitest";
import { sameTextCountsOnce } from "../src/modules/verification/index.js";

describe("textos idénticos cuentan como uno (ADR 0074)", () => {
  it("cada grupo de texto aporta su mayor peso; sin texto suma normal", () => {
    const w = new Map([["a", 1], ["b", 1.5], ["c", 0.5], ["d", 1]]);
    expect(sameTextCountsOnce([
      { userId: "a", textHash: "x" }, { userId: "b", textHash: "x" }, { userId: "c", textHash: null }, { userId: "d", textHash: "y" },
    ], w)).toBe(1.5 + 0.5 + 1);
  });
});
