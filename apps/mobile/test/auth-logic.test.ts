import { describe, expect, it } from "vitest";
import { canRetryWithRefresh, deleteConfirmed, singleFlight } from "../src/lib/auth/refresh";

describe("sesión (lógica de la app)", () => {
  it("una sola renovación en vuelo aunque fallen varias peticiones a la vez", async () => {
    let calls = 0;
    let release!: () => void;
    const renew = singleFlight(() => new Promise<number>((r) => { calls++; release = () => r(calls); }));
    const all = Promise.all([renew(), renew(), renew()]);
    release();
    expect(await all).toEqual([1, 1, 1]);
    // Terminada la anterior, la siguiente vuelve a renovar.
    const next = renew();
    release();
    expect(await next).toBe(2);
  });

  it("libera el vuelo también si falla", async () => {
    let n = 0;
    const f = singleFlight(async () => { n++; if (n === 1) throw new Error("red"); return n; });
    await expect(f()).rejects.toThrow("red");
    expect(await f()).toBe(2);
  });

  it("reintenta solo un 401 fuera de /v1/auth, una vez y con refresh", () => {
    expect(canRetryWithRefresh("/v1/feed", 401, false, true)).toBe(true);
    expect(canRetryWithRefresh("/v1/feed", 401, true, true)).toBe(false);
    expect(canRetryWithRefresh("/v1/feed", 401, false, false)).toBe(false);
    expect(canRetryWithRefresh("/v1/feed", 403, false, true)).toBe(false);
    expect(canRetryWithRefresh("/v1/auth/refresh", 401, false, true)).toBe(false);
  });

  it("confirmación de borrado tolerante a mayúsculas, tildes y espacios", () => {
    expect(deleteConfirmed(" borrar ", "BORRAR")).toBe(true);
    expect(deleteConfirmed("Borrár", "BORRAR")).toBe(true);
    expect(deleteConfirmed("BORRA", "BORRAR")).toBe(false);
    expect(deleteConfirmed("", "")).toBe(false);
    expect(deleteConfirmed("delete", "DELETE")).toBe(true);
  });
});
