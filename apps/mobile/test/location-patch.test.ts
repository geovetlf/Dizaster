import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

// Ubicación simulada en iOS (ADR 0195): el parche local de expo-location sigue aplicado tras actualizar dependencias.
describe("parche de expo-location", () => {
  it("iOS exporta `mocked` desde isSimulatedBySoftware", () => {
    const pkg = createRequire(import.meta.url).resolve("expo-location/package.json");
    const swift = readFileSync(join(dirname(pkg), "ios", "LocationUtils.swift"), "utf8");
    expect(swift).toContain('result["mocked"] = info.isSimulatedBySoftware');
  });
});
