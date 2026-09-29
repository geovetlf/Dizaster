import { describe, expect, it } from "vitest";
import { sampleRatio, startTelemetry } from "../src/telemetry.js";

describe("OpenTelemetry (ADR 0052)", () => {
  it("sin endpoint no arranca nada", async () => {
    expect(await startTelemetry({})).toBe(false);
  });

  it("muestreo por defecto 10 % y acotado a [0, 1]", () => {
    expect(sampleRatio(undefined)).toBe(0.1);
    expect(sampleRatio("")).toBe(0.1);
    expect(sampleRatio("0.5")).toBe(0.5);
    expect(sampleRatio("7")).toBe(1);
    expect(sampleRatio("-1")).toBe(0);
    expect(sampleRatio("x")).toBe(0.1);
  });
});
