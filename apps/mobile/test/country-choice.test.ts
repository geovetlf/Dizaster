import { describe, expect, it } from "vitest";
import { chooseCountry, filterCountries } from "../src/lib/geo/country-choice";

// País preferido (ADR 0085). NO AI REQUIRED.
const ALL = [
  { code: "PE", name: "Perú" },
  { code: "PA", name: "Panamá" },
  { code: "CL", name: "Chile" },
  { code: "PT", name: "Portugal" },
  { code: "GB", name: "Reino Unido" },
];

describe("chooseCountry", () => {
  it("ubicación, luego perfil, luego ajustes", () => {
    expect(chooseCountry("CL", "PE", "ES")).toEqual({ country: "CL", source: "location" });
    expect(chooseCountry(null, "PE", "ES")).toEqual({ country: "PE", source: "profile" });
    expect(chooseCountry(null, null, "ES")).toEqual({ country: "ES", source: "settings" });
    expect(chooseCountry(null, null, null)).toEqual({ country: null, source: null });
    // SIM (ADR 0169): después de la ubicación y antes del perfil; códigos raros se ignoran.
    expect(chooseCountry(null, "PE", "ES", "cl")).toEqual({ country: "CL", source: "sim" });
    expect(chooseCountry("AR", "PE", "ES", "cl")).toEqual({ country: "AR", source: "location" });
    expect(chooseCountry(null, "PE", "ES", "")).toEqual({ country: "PE", source: "profile" });
    expect(chooseCountry(null, "PE", "ES", "xyz")).toEqual({ country: "PE", source: "profile" });
  });
});

describe("filterCountries", () => {
  it("sin búsqueda muestra solo las sugeridas válidas", () => {
    expect(filterCountries(ALL, "", ["PE", "XX", null, "PE"]).map((c) => c.code)).toEqual(["PE"]);
  });
  it("busca por nombre sin tildes, por palabra y por código", () => {
    expect(filterCountries(ALL, "peru").map((c) => c.code)).toEqual(["PE"]);
    expect(filterCountries(ALL, "p").map((c) => c.code)).toEqual(["PE", "PA", "PT"]);
    expect(filterCountries(ALL, "unido").map((c) => c.code)).toEqual(["GB"]);
    expect(filterCountries(ALL, "cl").map((c) => c.code)).toEqual(["CL"]);
    expect(filterCountries(ALL, "p", ["PT"]).map((c) => c.code)).toEqual(["PT", "PE", "PA"]);
    expect(filterCountries(ALL, "p", [], 2)).toHaveLength(2);
  });
});
