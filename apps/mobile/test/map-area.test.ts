import { describe, expect, it } from "vitest";
import { areaBounds } from "../src/lib/map/area";

describe("recuadro del área oficial (ADR 0144)", () => {
  const area = { type: "MultiPolygon" as const, coordinates: [[[[-77, -12], [-76, -12], [-76, -11], [-77, -11], [-77, -12]]]] };
  it("incluye el área y el punto, con margen", () => {
    const b = areaBounds(area, { lat: -13, lng: -76.5 })!;
    expect(b[0]).toBeCloseTo(-77.1);
    expect(b[1]).toBeCloseTo(-13.2);
    expect(b[2]).toBeCloseTo(-75.9);
    expect(b[3]).toBeCloseTo(-10.8);
  });
  it("sin coordenadas válidas no hay recuadro", () => {
    expect(areaBounds({ type: "MultiPolygon", coordinates: [] }, { lat: 0, lng: 0 })).toBeNull();
  });
});
