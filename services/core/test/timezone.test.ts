import { describe, expect, it } from "vitest";
import { polygonTimezones, resolveTimezone } from "../src/modules/geo/index.js";

describe("zona horaria por polígonos (ADR 0050)", () => {
  const polygons = polygonTimezones(4);

  it("resuelve ciudades de países con varias zonas", () => {
    expect(polygons.at({ lat: -23.55, lng: -46.63 })).toBe("America/Sao_Paulo");
    expect(polygons.at({ lat: -3.12, lng: -60.02 })).toBe("America/Manaus");
    expect(polygons.at({ lat: 19.43, lng: -99.13 })).toBe("America/Mexico_City");
    expect(polygons.at({ lat: 21.16, lng: -86.85 })).toBe("America/Cancun");
    expect(polygons.at({ lat: -12.05, lng: -77.04 })).toBe("America/Lima");
  });

  it("en el mar da la zona náutica", () => {
    expect(polygons.at({ lat: -15, lng: -85 })).toBe("Etc/GMT+6");
  });

  it("un país con una sola zona no consulta polígonos", () => {
    const never = { at: () => { throw new Error("no debía consultarse"); } };
    expect(resolveTimezone({ lat: -12, lng: -77 }, ["America/Lima"], never)).toBe("America/Lima");
    expect(resolveTimezone({ lat: -3.12, lng: -60.02 }, ["America/Sao_Paulo", "America/Manaus"], polygons)).toBe("America/Manaus");
    expect(resolveTimezone({ lat: -3.12, lng: -60.02 }, undefined, polygons)).toBe("America/Manaus");
  });
});
