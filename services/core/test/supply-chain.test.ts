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

describe("excepciones de avisos acotadas (ADR 0305)", () => {
  type Advisory = { module_name: string; severity: string; findings: { version: string; paths: string[] }[] };
  type Entry = { id: number; package: string; reviewBy: string; versions: string[]; paths: string[] };
  const load = async () => {
    const url = new URL("../../../scripts/supply-chain.mjs", import.meta.url).href;
    return (await import(/* @vite-ignore */ url)) as {
      blockingAdvisories: (r: { advisories: Record<string, Advisory> }, a: Entry[], today: string) => [string, Advisory][];
      expiringSoon: (a: Entry[], today: string, days?: number) => Entry[];
    };
  };
  const entry: Entry = { id: 1, package: "node-forge", reviewBy: "2026-11-06", versions: ["1.4.0"], paths: ["apps__mobile>expo>@expo/cli>node-forge"] };
  const report = (a: Partial<Advisory>) => ({ advisories: { "1": { module_name: "node-forge", severity: "high", findings: [{ version: "1.4.0", paths: ["apps__mobile>expo>@expo/cli>node-forge"] }], ...a } } });

  it("acepta solo el paquete, la versión y la ruta exactas mientras no venza", async () => {
    const { blockingAdvisories } = await load();
    expect(blockingAdvisories(report({}), [entry], "2026-10-10")).toHaveLength(0);
    expect(blockingAdvisories(report({}), [entry], "2026-11-07")).toHaveLength(1);
  });

  it("vuelve a bloquear si el paquete llega por otra ruta, en otra versión o con otro nombre", async () => {
    const { blockingAdvisories } = await load();
    const otherPath = report({ findings: [{ version: "1.4.0", paths: ["apps__mobile>expo>@expo/cli>node-forge", "services__core>node-forge"] }] });
    expect(blockingAdvisories(otherPath, [entry], "2026-10-10")).toHaveLength(1);
    expect(blockingAdvisories(report({ findings: [{ version: "1.3.3", paths: entry.paths }] }), [entry], "2026-10-10")).toHaveLength(1);
    expect(blockingAdvisories(report({ module_name: "otro" }), [entry], "2026-10-10")).toHaveLength(1);
    expect(blockingAdvisories(report({ findings: [] }), [entry], "2026-10-10")).toHaveLength(1);
  });

  it("los avisos moderate o low no bloquean; los critical sin excepción sí", async () => {
    const { blockingAdvisories } = await load();
    expect(blockingAdvisories(report({ severity: "moderate" }), [], "2026-10-10")).toHaveLength(0);
    expect(blockingAdvisories(report({ severity: "critical" }), [], "2026-10-10")).toHaveLength(1);
  });

  it("anuncia las excepciones que vencen en 14 días o menos", async () => {
    const { expiringSoon } = await load();
    expect(expiringSoon([entry], "2026-10-10")).toHaveLength(0);
    expect(expiringSoon([entry], "2026-10-23")).toHaveLength(1);
    expect(expiringSoon([entry], "2026-11-07")).toHaveLength(0);
  });
});
