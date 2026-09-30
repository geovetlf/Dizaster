import { describe, expect, it } from "vitest";
import { CONFIG_FRESH_MS, configCache, type ConfigStore } from "../src/lib/config/config-cache";

// Config remota persistida (ADR 0185). NO AI REQUIRED.
const memStore = <T,>(initial: T | null = null) => {
  let v = initial;
  const s: ConfigStore<T> & { value: () => T | null } = { load: async () => v, save: async (x) => { v = x; }, value: () => v };
  return s;
};

describe("configCache", () => {
  it("con red guarda la config; sin red devuelve la guardada aunque sea vieja", async () => {
    const store = memStore<{ v: number }>();
    let online = true;
    let n = 0;
    let clock = 0;
    const c = configCache(async () => { if (!online) throw new Error("offline"); return { v: ++n }; }, store, () => clock);
    expect(await c.get()).toEqual({ v: 1 });
    expect(store.value()).toEqual({ v: 1 });
    online = false;
    clock += 30 * 24 * 3600_000;
    expect(await c.get()).toEqual({ v: 1 });
  });

  it("sin red y sin copia propaga el error", async () => {
    const c = configCache(async () => { throw new Error("offline"); }, memStore<number>());
    await expect(c.get()).rejects.toThrow("offline");
  });

  it("varias pantallas a la vez hacen una sola petición, y se reutiliza unos minutos", async () => {
    let calls = 0;
    let clock = 0;
    const c = configCache(async () => ++calls, memStore<number>(), () => clock);
    await Promise.all([c.get(), c.get(), c.get()]);
    expect(calls).toBe(1);
    clock += CONFIG_FRESH_MS - 1;
    await c.get();
    expect(calls).toBe(1);
    clock += 2;
    expect(await c.get()).toBe(2);
  });
});
