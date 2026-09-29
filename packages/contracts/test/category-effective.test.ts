import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CategoryCatalog, categoriesFor, effectiveCategory } from "../src/index.js";

const catalog = CategoryCatalog.parse(JSON.parse(readFileSync(new URL("../../../data/categories/categories.json", import.meta.url), "utf8")));

describe("categoría efectiva por país (ADR 0152)", () => {
  it("aplica nombres y ajustes del país y deja la base sin país", () => {
    expect(effectiveCategory(catalog, "natural.landslide", "PE")?.names.es).toBe("Huaico");
    expect(effectiveCategory(catalog, "natural.landslide", null)?.names.es).not.toBe("Huaico");
    expect(effectiveCategory(catalog, "no.existe", "PE")).toBeUndefined();
    const off = { ...catalog, regionOverrides: [{ category: "natural.landslide", country: "CL", enabled: false, overrides: {} }] };
    expect(effectiveCategory(off, "natural.landslide", "CL")).toBeUndefined();
    expect(categoriesFor(off, "CL").map((c) => c.code)).not.toContain("natural.landslide");
    expect(categoriesFor(off, "PE")).toHaveLength(catalog.categories.length);
  });
});
