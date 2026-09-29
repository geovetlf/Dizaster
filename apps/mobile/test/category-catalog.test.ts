import type { CategoryCatalog } from "@dizaster/contracts";
import { describe, expect, it } from "vitest";
import { describeCategory, newestCatalog, pickableCategories, reportableCategories } from "../src/lib/category-catalog";

const base = {
  code: "natural.landslide", parent: "natural", names: { es: "Deslizamiento", en: "Landslide" }, icon: "x", defaultSeverity: 3,
  presenceRadiusM: 500, dedupRadiusM: 1000, dedupWindowMinutes: 60, offlineToleranceMinutes: 30, communityThreshold: 3,
  sensitivity: "NORMAL" as const, citizenReportable: true, alertable: true, compatibleWith: [], forcePseudonymous: false, publishDelayMinutes: 0,
};
const catalog: CategoryCatalog = {
  version: "categories-2026.09.2",
  categories: [
    { ...base, code: "natural", parent: null, names: { es: "Naturales" } },
    base,
    { ...base, code: "natural.cold_wave", names: { es: "Ola de frío" } },
  ],
  regionOverrides: [
    { category: "natural.landslide", country: "PE", enabled: true, names: { es: "Huaico" }, overrides: { presenceRadiusM: 800 } },
    { category: "natural.cold_wave", country: "CL", enabled: false, overrides: {} },
  ],
};

describe("catálogo de categorías en el teléfono (ADR 0152)", () => {
  it("solo reemplaza el empaquetado por uno válido y más nuevo", () => {
    expect(newestCatalog(catalog, { ...catalog, version: "categories-2026.10.1" }).version).toBe("categories-2026.10.1");
    expect(newestCatalog(catalog, { ...catalog, version: "categories-2026.09.1" })).toBe(catalog);
    expect(newestCatalog(catalog, { version: "categories-2027.01.1" })).toBe(catalog);
    expect(newestCatalog(catalog, null)).toBe(catalog);
  });

  it("aplica los ajustes del país al elegir y conserva el nombre al mostrar", () => {
    expect(describeCategory(catalog, "natural.landslide", "PE")).toMatchObject({ presenceRadiusM: 800, names: { es: "Huaico", en: "Landslide" } });
    expect(describeCategory(catalog, "natural.landslide", null)?.names.es).toBe("Deslizamiento");
    expect(pickableCategories(catalog, "CL").map((c) => c.code)).not.toContain("natural.cold_wave");
    expect(describeCategory(catalog, "natural.cold_wave", "CL")?.names.es).toBe("Ola de frío");
    expect(reportableCategories(catalog, "PE").map((c) => c.code)).toEqual(["natural.landslide", "natural.cold_wave"]);
    expect(reportableCategories(catalog, "CL").map((c) => c.code)).toEqual(["natural.landslide"]);
  });
});
