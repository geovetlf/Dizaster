import { describe, expect, it } from "vitest";
import { waitForProcessed } from "../src/lib/media/avatar-ready";

describe("espera de la foto procesada (ADR 0119)", () => {
  const seq = (states: string[]) => { let i = 0; return async () => states[Math.min(i++, states.length - 1)]!; };
  const noSleep = async () => undefined;

  it("devuelve READY en cuanto el servidor la procesa", async () => {
    let slept = 0;
    expect(await waitForProcessed(seq(["UPLOADED", "PROCESSING", "READY"]), async () => { slept++; })).toBe("READY");
    expect(slept).toBe(2);
  });

  it("corta si el servidor la rechaza", async () => {
    expect(await waitForProcessed(seq(["PROCESSING", "REJECTED"]), noSleep)).toBe("REJECTED");
  });

  it("se rinde tras los intentos sin dormir después del último", async () => {
    let slept = 0;
    expect(await waitForProcessed(seq(["PROCESSING"]), async () => { slept++; }, { tries: 3 })).toBe("TIMEOUT");
    expect(slept).toBe(2);
  });
});
