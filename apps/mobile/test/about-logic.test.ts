import type { Attribution } from "@dizaster/contracts";
import { describe, expect, it } from "vitest";
import { groupAttributions } from "../src/lib/about/libraries";

const a = (id: string, kind: Attribution["kind"], attribution = id): Attribution => ({ id, kind, name: id, attribution, license: "X", url: null });

describe("groupAttributions", () => {
  it("ordena por tipo, omite grupos vacíos y colapsa textos repetidos", () => {
    const groups = groupAttributions([a("usgs", "SOURCE"), a("ne-1", "GEO", "Made with Natural Earth"), a("osm", "MAP"), a("ne-2", "GEO", "Made with Natural Earth")]);
    expect(groups.map((g) => g.kind)).toEqual(["MAP", "GEO", "SOURCE"]);
    expect(groups[1]!.items.map((i) => i.id)).toEqual(["ne-1"]);
  });
});
