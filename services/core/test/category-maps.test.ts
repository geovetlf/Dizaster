import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FEED_ADAPTERS } from "../src/modules/ingestion/index.js";
import { COPERNICUS_CATEGORY_MAP } from "../src/modules/ingestion/adapters/copernicus-ems.js";
import { GDACS_CATEGORY_MAP } from "../src/modules/ingestion/adapters/gdacs.js";
import { RELIEFWEB_CATEGORY_MAP } from "../src/modules/ingestion/adapters/reliefweb.js";
import { validateSourceCategoryMaps } from "../src/modules/reference/index.js";

// Mapeo de categorías por fuente como dato del registro (§9.4, ADR 0122). NO AI REQUIRED.
const registry = JSON.parse(readFileSync(new URL("../../../data/source-registry/sources.json", import.meta.url), "utf8")) as {
  sources: { key: string; config: Record<string, unknown> }[];
};
const configOf = (key: string) => registry.sources.find((s) => s.key === key)!.config;

describe("mapeo de categorías por fuente", () => {
  it("el registro trae el mapeo de GDACS, ReliefWeb y Copernicus (igual al de fábrica)", () => {
    expect(configOf("gdacs")["categoryMap"]).toEqual(GDACS_CATEGORY_MAP);
    expect(configOf("reliefweb-disasters")["categoryMap"]).toEqual(RELIEFWEB_CATEGORY_MAP);
    expect(configOf("copernicus-ems")["categoryMap"]).toEqual(COPERNICUS_CATEGORY_MAP);
  });

  it("cambiar el mapeo es configuración: el adapter usa el del registro", () => {
    const gdacs = FEED_ADAPTERS.get("gdacs-rss")!;
    const body = readFileSync(new URL("./fixtures/gdacs-rss.xml", import.meta.url), "utf8");
    expect(gdacs.parse(body, {}).map((i) => i.categoryCode)).toEqual(["natural.flood", "natural.earthquake"]);
    // Una fuente que solo quiere inundaciones: el sismo deja de entrar.
    expect(gdacs.parse(body, { categoryMap: { FL: "natural.flood" } }).map((i) => i.categoryCode)).toEqual(["natural.flood"]);

    const ems = FEED_ADAPTERS.get("copernicus-ems-georss")!;
    const xml = readFileSync(new URL("./fixtures/copernicus-ems.xml", import.meta.url), "utf8");
    // "Industrial accident" pasa a contar si el registro lo mapea (aquí, a un incendio de estructura).
    const mapped = ems.parse(xml, { categoryMap: { ...COPERNICUS_CATEGORY_MAP, "industrial accident": "fire.structure" } });
    expect(mapped.map((i) => [i.externalId, i.categoryCode])).toContainEqual(["EMSR814", "fire.structure"]);
  });

  it("el registro no puede mapear a categorías inexistentes ni no declaradas", () => {
    const leaf = (c: string) => ["natural.flood", "natural.storm"].includes(c);
    const src = (config: Record<string, unknown>) => [{ key: "x", categories: ["natural.flood"], config }];
    expect(() => validateSourceCategoryMaps(src({ categoryMap: { FL: "natural.flood" } }), leaf)).not.toThrow();
    expect(() => validateSourceCategoryMaps(src({ categoryMap: { FL: "natural.inventada" } }), leaf)).toThrow(/inexistente/);
    expect(() => validateSourceCategoryMaps(src({ categoryMap: { TC: "natural.storm" } }), leaf)).toThrow(/no declara/);
    expect(() => validateSourceCategoryMaps(src({ eventMap: [{ match: "lluvia", category: "natural.storm" }] }), leaf)).toThrow(/no declara/);
  });
});
