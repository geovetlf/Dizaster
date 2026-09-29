import { describe, expect, it } from "vitest";

describe("política de licencias (ADR 0070)", () => {
  it("expresiones SPDX: OR vale con una opción permitida; AND necesita todas", async () => {
    const url = new URL("../../../scripts/supply-chain.mjs", import.meta.url).href;
    const { licenseAllowed } = (await import(/* @vite-ignore */ url)) as { licenseAllowed: (e: string, a: string[]) => boolean };
    const allowed = ["MIT", "Apache-2.0", "BSD-3-Clause"];
    expect(licenseAllowed("MIT", allowed)).toBe(true);
    expect(licenseAllowed("(BSD-3-Clause OR GPL-2.0)", allowed)).toBe(true);
    expect(licenseAllowed("MIT AND Apache-2.0", allowed)).toBe(true);
    expect(licenseAllowed("MIT AND GPL-3.0", allowed)).toBe(false);
    expect(licenseAllowed("AGPL-3.0", allowed)).toBe(false);
  });
});
