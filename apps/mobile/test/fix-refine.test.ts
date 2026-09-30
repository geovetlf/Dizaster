import { describe, expect, it } from "vitest";
import { betterFix, pinFollowsFix, pushRecent } from "../src/lib/report/fix-refine";
import type { LocationLike } from "../src/lib/report/presence";

// Seguimiento breve del GPS (ADR 0192). NO AI REQUIRED.
const at = (timestamp: number, accuracy: number | null, lat = -12.1, lng = -77.03): LocationLike => ({
  coords: { latitude: lat, longitude: lng, accuracy, altitude: null, speed: null, heading: null }, timestamp,
});

describe("afinar el fix", () => {
  it("solo reemplaza por una lectura más precisa, posterior, y mientras no llegue a 50 m", () => {
    expect(betterFix(at(0, 120), at(5, 30))).toBe(true);
    expect(betterFix(at(0, 120), at(5, 200))).toBe(false);
    expect(betterFix(at(0, 40), at(5, 5))).toBe(false);
    expect(betterFix(at(10, 120), at(5, 30))).toBe(false);
    expect(betterFix(at(0, null), at(5, 80))).toBe(true);
  });

  it("trayectoria: sin repetidos, ordenada y con las 10 más recientes", () => {
    let list: LocationLike[] = [];
    for (let i = 12; i >= 0; i--) list = pushRecent(list, at(i * 1000, 10));
    list = pushRecent(list, at(12_000, 10));
    expect(list.map((l) => l.timestamp)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((s) => s * 1000));
  });

  it("el pin sigue al fix solo si la persona no lo movió", () => {
    const f = at(0, 100);
    expect(pinFollowsFix({ lat: -12.1, lng: -77.03 }, f)).toBe(true);
    expect(pinFollowsFix({ lat: -12.1005, lng: -77.03 }, f)).toBe(false);
  });
});
