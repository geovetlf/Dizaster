import { afterEach, describe, expect, it, vi } from "vitest";
import { withTimeout } from "../src/lib/async/timeout";

describe("withTimeout (ADR 0183)", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("devuelve el valor si llega a tiempo", async () => {
    await expect(withTimeout(Promise.resolve(7), 1000)).resolves.toBe(7);
  });

  it("devuelve null si no llega a tiempo", async () => {
    vi.useFakeTimers();
    const never = new Promise<number>(() => undefined);
    const r = withTimeout(never, 20_000);
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(r).resolves.toBeNull();
  });

  it("propaga el error si falla antes del plazo", async () => {
    await expect(withTimeout(Promise.reject(new Error("x")), 1000)).rejects.toThrow("x");
  });
});
