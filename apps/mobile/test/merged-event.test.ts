import { describe, expect, it } from "vitest";
import { MAX_MERGE_HOPS, mergedTarget } from "../src/lib/events/merged";

describe("mergedTarget", () => {
  it("redirige al destino de la fusión", () => {
    expect(mergedTarget({ id: "a", mergedIntoId: "b" }, 0)).toBe("b");
  });
  it("no redirige un evento sin fusionar o apuntando a sí mismo", () => {
    expect(mergedTarget({ id: "a", mergedIntoId: null }, 0)).toBeNull();
    expect(mergedTarget({ id: "a" }, 0)).toBeNull();
    expect(mergedTarget({ id: "a", mergedIntoId: "a" }, 0)).toBeNull();
  });
  it("corta cadenas demasiado largas", () => {
    expect(mergedTarget({ id: "a", mergedIntoId: "b" }, MAX_MERGE_HOPS)).toBeNull();
  });
});
