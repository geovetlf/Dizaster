import { describe, expect, it } from "vitest";
import { OFFLINE_MAX_TILES, planZonePack, tileCount, zoneBounds } from "../src/lib/map/offline-plan";

const LIMA = { lat: -12.0464, lng: -77.0428 };

describe("mapa offline por zona (ADR 0041)", () => {
  it("el rectángulo cubre el radio con margen", () => {
    const [w, s, e, n] = zoneBounds(LIMA, 5);
    expect(n - s).toBeCloseTo((2 * 5.5) / 110.574, 3);
    expect(e - w).toBeGreaterThan(n - s); // cerca del ecuador un grado de longitud mide casi lo mismo
    expect(w).toBeLessThan(LIMA.lng);
  });

  it("cuenta teselas: el mundo entero a zoom 1 son 4", () => {
    expect(tileCount([-180, -85, 179.99, 85], 1, 1)).toBe(4);
  });

  it("una zona pequeña se baja con todo el detalle; una grande, con menos zoom y dentro del límite", () => {
    const small = planZonePack(LIMA, 2);
    expect(small.maxZoom).toBe(15);
    const big = planZonePack(LIMA, 50);
    expect(big.maxZoom).toBeLessThan(15);
    expect(big.tiles).toBeLessThanOrEqual(OFFLINE_MAX_TILES);
    expect(big.estimatedMb).toBeGreaterThan(small.estimatedMb);
  });
});
