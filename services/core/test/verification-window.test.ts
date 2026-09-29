import { describe, expect, it } from "vitest";
import { bestWindowWeight } from "../src/modules/verification/index.js";

// Ventana de tiempo coherente al corroborar (ADR 0081). NO AI REQUIRED.
const at = (min: number) => new Date(Date.UTC(2026, 8, 29, 10, 0) + min * 60_000);
const ev = (user: string, min: number, device: string | null = null, textHash: string | null = null) =>
  ({ contributorUserId: user, contributorDeviceId: device, textHash, observedAt: at(min) });
const w = new Map([["a", 1], ["b", 1], ["c", 1], ["d", 0.5]]);

describe("peso por ventana", () => {
  it("toma la ventana con más peso y devuelve sus horas", () => {
    const r = bestWindowWeight([ev("a", 0), ev("b", 3000), ev("c", 3010), ev("d", 3020)], w, 120 * 60_000);
    expect(r).toEqual({ weight: 2.5, from: at(3000).toISOString(), to: at(3020).toISOString() });
  });

  it("repartidos en días no suman juntos", () => {
    expect(bestWindowWeight([ev("a", 0), ev("b", 1440), ev("c", 2880)], w, 360 * 60_000).weight).toBe(1);
  });

  it("dentro de la ventana siguen valiendo persona, dispositivo y texto únicos", () => {
    expect(bestWindowWeight([ev("a", 0, "p1"), ev("a", 1, "p2"), ev("b", 2, "p1"), ev("c", 3, "p3", "x"), ev("d", 4, "p4", "x")], w, 60 * 60_000).weight).toBe(2);
    expect(bestWindowWeight([], w, 1000)).toEqual({ weight: 0, from: null, to: null });
  });
});
