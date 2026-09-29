import { describe, expect, it } from "vitest";
import { MemoryCacheStore, READ_CACHE_LIMITS, cacheKeys, readThrough } from "../src/lib/offline/read-cache";

const offline = () => Promise.reject(new Error("Network request failed"));

describe("lectura sin conexión (ADR 0066)", () => {
  it("con red devuelve lo fresco y lo guarda; sin red, la copia con su hora", async () => {
    const store = new MemoryCacheStore();
    let now = 1_000;
    const fresh = await readThrough(store, cacheKeys.alerts, async () => ({ n: 1 }), () => now);
    expect(fresh).toEqual({ value: { n: 1 }, savedAt: null });
    now = 5_000;
    expect(await readThrough(store, cacheKeys.alerts, offline, () => now)).toEqual({ value: { n: 1 }, savedAt: 1_000 });
  });

  it("sin copia, o con una de más de 7 días, propaga el error", async () => {
    const store = new MemoryCacheStore();
    await expect(readThrough(store, cacheKeys.event("x"), offline)).rejects.toThrow("Network");
    await store.set(cacheKeys.event("x"), { old: true }, 0);
    await expect(readThrough(store, cacheKeys.event("x"), offline, () => READ_CACHE_LIMITS.maxAgeMs + 1)).rejects.toThrow("Network");
  });

  it("un fallo al guardar no rompe la pantalla", async () => {
    const store = new MemoryCacheStore();
    store.set = () => Promise.reject(new Error("disk full"));
    expect((await readThrough(store, "k", async () => 42)).value).toBe(42);
  });

  it("poda por antigüedad y por cantidad, quedándose con lo más reciente", async () => {
    const store = new MemoryCacheStore();
    for (let i = 0; i < 10; i++) await store.set(`k${i}`, i, i * 1000);
    await store.prune(3, 8_500, 10_000);
    expect(store.size).toBe(3);
    expect(await store.get("k9")).not.toBeNull();
    expect(await store.get("k6")).toBeNull();
  });

  it("las claves no llevan ubicación", () => {
    expect(Object.values(cacheKeys).filter((k) => typeof k === "string").join(" ")).not.toMatch(/\d+\.\d+/);
  });
});
