import { describe, expect, it } from "vitest";
import { cameOnline, online } from "../src/lib/report/connectivity";
import { fetchWithTimeout } from "../src/lib/async/timeout";
import { networkErrorKey } from "../src/lib/errors/network-error";

// Cola que se envía sola (ADR 0190). NO AI REQUIRED.
describe("vuelta de la red", () => {
  it("solo el paso de sin red a con red dispara un envío", () => {
    expect(cameOnline(null, { isConnected: true })).toBe(true);
    expect(cameOnline({ isConnected: false }, { isConnected: true, isInternetReachable: true })).toBe(true);
    expect(cameOnline({ isConnected: true }, { isConnected: true })).toBe(false);
    expect(cameOnline({ isConnected: false }, { isConnected: true, isInternetReachable: false })).toBe(false);
    expect(online({ isConnected: true, isInternetReachable: false })).toBe(false);
  });
});

describe("fetchWithTimeout", () => {
  const hang: typeof fetch = (_u, init) => new Promise((_r, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
  });

  it("aborta al vencer y falla como error de red (sin status)", async () => {
    const e = (await fetchWithTimeout("https://x", {}, 20, hang).then(() => null, (err: unknown) => err)) as Error & { status?: number };
    expect(e.message).toMatch(/Sin respuesta/);
    expect(e.status).toBeUndefined();
    // La app lo muestra como "sin respuesta" traducido, no con este texto (ADR 0292).
    expect(networkErrorKey(e)).toBe("errTimeout");
    expect(networkErrorKey(new TypeError("Network request failed"))).toBe("errOffline");
    expect(networkErrorKey(null)).toBe("errOffline");
  });

  it("respeta la señal de quien llama", async () => {
    const ctrl = new AbortController();
    const p = fetchWithTimeout("https://x", { signal: ctrl.signal }, 10_000, hang);
    ctrl.abort();
    await expect(p).rejects.toThrow("aborted");
  });

  it("devuelve la respuesta si llega a tiempo", async () => {
    const ok: typeof fetch = async () => new Response("hola");
    expect(await (await fetchWithTimeout("https://x", {}, 1000, ok)).text()).toBe("hola");
  });
});
