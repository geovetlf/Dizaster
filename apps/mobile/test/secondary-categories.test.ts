import { describe, expect, it } from "vitest";
import { secondaryLine } from "../src/lib/events/secondary";

describe("categorías secundarias en la ficha (ADR 0125)", () => {
  const names: Record<string, string> = { "infra.road_blocked": "Vía bloqueada", "accident.traffic": "Accidente de tránsito" };
  const nameOf = (c: string) => names[c] ?? c;
  it("muestra las secundarias sin la principal y sin repetir", () => {
    expect(secondaryLine({ categoryCode: "accident.traffic", secondaryCategories: ["infra.road_blocked", "accident.traffic", "infra.road_blocked"] }, nameOf, "También:"))
      .toBe("También: Vía bloqueada");
  });
  it("nada si no hay (o si el servidor aún no las envía)", () => {
    expect(secondaryLine({ categoryCode: "accident.traffic", secondaryCategories: [] }, nameOf, "También:")).toBeNull();
    expect(secondaryLine({ categoryCode: "accident.traffic" }, nameOf, "También:")).toBeNull();
  });
});
