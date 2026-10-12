import { readFileSync } from "node:fs";
import type { AppConfig } from "@dizaster/contracts";
import { describe, expect, it } from "vitest";
import { configCache, type ConfigStore } from "../src/lib/config/config-cache";
import { effectiveLaunchConfig, reportsOpenIn, reportsOpenWith, type LaunchConfig } from "../src/lib/geo/launch-status";

// Estado de lanzamiento desde /v1/config con el archivo empaquetado de respaldo (ADR 0334, ADR 0341). NO AI REQUIRED.
const bundled: LaunchConfig = {
  version: "countries-2026.09.3",
  defaults: { launchStatus: "AVAILABLE_READ_ONLY" },
  countries: [{ iso2: "PE", launchStatus: "PILOT" }, { iso2: "CL", launchStatus: "AVAILABLE_READ_ONLY" }],
};
const remote = (version: string) => ({
  version,
  defaults: { launchStatus: "AVAILABLE_READ_ONLY", acceptsCitizenReports: false },
  countries: [
    { iso2: "PE", launchStatus: "PILOT", acceptsCitizenReports: true },
    { iso2: "CL", launchStatus: "AVAILABLE", acceptsCitizenReports: true },
  ],
});

describe("launch de /v1/config (ADR 0334)", () => {
  it("con config válida y más nueva, la usa: un país recién abierto acepta reportes sin versión nueva de la app", () => {
    const cfg = effectiveLaunchConfig(bundled, remote("countries-2026.10.1"));
    expect(cfg.version).toBe("countries-2026.10.1");
    expect(reportsOpenWith(cfg, "CL")).toBe(true);
    expect(reportsOpenWith(cfg, "PE")).toBe(true);
    expect(reportsOpenWith(cfg, "AR")).toBe(false);
    expect(reportsOpenWith(cfg, null)).toBe(false);
  });

  it("sin config (servidor anterior o sin red y sin copia), el archivo empaquetado", () => {
    expect(effectiveLaunchConfig(bundled, undefined)).toBe(bundled);
    expect(effectiveLaunchConfig(bundled, null)).toBe(bundled);
    expect(reportsOpenWith(effectiveLaunchConfig(bundled, undefined), "CL")).toBe(false);
    expect(reportsOpenWith(effectiveLaunchConfig(bundled, undefined), "PE")).toBe(true);
  });

  it("mal formada, el archivo empaquetado (nunca abre con un dato que no se entiende)", () => {
    const bad: unknown[] = [
      "PILOT",
      { countries: [] },
      { ...remote("countries-2026.10.1"), version: 3 },
      { ...remote("countries-2026.10.1"), defaults: { launchStatus: "OPEN", acceptsCitizenReports: true } },
      { ...remote("countries-2026.10.1"), countries: [{ iso2: "CL", launchStatus: "OPEN", acceptsCitizenReports: true }] },
      { ...remote("countries-2026.10.1"), countries: [{ iso2: "cl", launchStatus: "AVAILABLE", acceptsCitizenReports: true }] },
      { ...remote("countries-2026.10.1"), countries: [{ iso2: "CL", launchStatus: "AVAILABLE" }] },
      { ...remote("countries-2026.10.1"), countries: "CL" },
    ];
    for (const b of bad) {
      expect(effectiveLaunchConfig(bundled, b)).toBe(bundled);
      expect(reportsOpenWith(effectiveLaunchConfig(bundled, b), "CL")).toBe(false);
    }
  });

  it("la versión más nueva gana: una config guardada antes de actualizar la app no pisa el bundle", () => {
    expect(effectiveLaunchConfig(bundled, remote("countries-2026.09.2"))).toBe(bundled);
    expect(effectiveLaunchConfig(bundled, remote("countries-2025.12.9"))).toBe(bundled);
    expect(effectiveLaunchConfig(bundled, remote("countries-2026.09.3")).version).toBe("countries-2026.09.3");
    expect(effectiveLaunchConfig(bundled, remote("countries-2026.09.10")).version).toBe("countries-2026.09.10");
    // Un bundle sin versión no puede ser más nuevo que un dato válido del servidor.
    const noVersion: LaunchConfig = { defaults: bundled.defaults, countries: bundled.countries };
    expect(effectiveLaunchConfig(noVersion, remote("countries-2026.01.1")).version).toBe("countries-2026.01.1");
  });

  it("si el dato dice acceptsCitizenReports: false, no abre aunque el estado lo permita", () => {
    const r = remote("countries-2026.10.1");
    r.countries[1] = { iso2: "CL", launchStatus: "AVAILABLE", acceptsCitizenReports: false };
    expect(reportsOpenWith(effectiveLaunchConfig(bundled, r), "CL")).toBe(false);
    // Y al revés: el indicador nunca abre un estado de solo lectura.
    r.countries[1] = { iso2: "CL", launchStatus: "RESTRICTED", acceptsCitizenReports: true };
    expect(reportsOpenWith(effectiveLaunchConfig(bundled, r), "CL")).toBe(false);
  });

  it("con el archivo real empaquetado: reportsOpenIn sin config y con una más vieja da lo mismo", () => {
    const real = JSON.parse(readFileSync(new URL("../../../data/countries/country-config.json", import.meta.url), "utf8")) as LaunchConfig;
    const stale = { ...remote("countries-2000.01.1"), countries: real.countries.map((c) => ({ iso2: c.iso2, launchStatus: "RESTRICTED", acceptsCitizenReports: false })) };
    for (const c of real.countries) {
      const open = c.launchStatus === "PILOT" || c.launchStatus === "AVAILABLE";
      expect(reportsOpenIn(c.iso2)).toBe(open);
      expect(reportsOpenIn(c.iso2, stale)).toBe(open);
      expect(reportsOpenIn(c.iso2, { broken: true })).toBe(open);
    }
  });

  it("se cachea con el resto de la config: sin red usa el launch de la última config guardada", async () => {
    let v: AppConfig | null = null;
    const store: ConfigStore<AppConfig> = { load: async () => v, save: async (x) => { v = x; } };
    let online = true;
    let clock = 0;
    const served = { launch: remote("countries-2026.10.1") } as unknown as AppConfig;
    const c = configCache(async () => { if (!online) throw new Error("offline"); return served; }, store, () => clock);
    await c.get();
    online = false;
    clock += 24 * 3600_000;
    const offline = await c.get();
    expect(reportsOpenWith(effectiveLaunchConfig(bundled, offline.launch), "CL")).toBe(true);
  });

  it("la pantalla de reporte lo lee de appConfig() sin enviar ubicación", () => {
    const report = readFileSync(new URL("../src/app/report.tsx", import.meta.url), "utf8");
    expect(report).toMatch(/const launch = \(await withTimeout\(appConfig\(\), LAUNCH_CONFIG_WAIT_MS\)\.catch\(\(\) => null\)\)\?\.launch;/);
    // /v1/config no lleva parámetros: nada de la ubicación sale para decidir esto.
    expect(readFileSync(new URL("../src/lib/api.ts", import.meta.url), "utf8")).toContain('config: () => request<AppConfig>("/v1/config")');
  });
});
