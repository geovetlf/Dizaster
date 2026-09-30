import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CATALOGS } from "../src/lib/i18n";

// C-18 (ADR 0227): la app dice en Emergencia y en Acerca de que no reemplaza a los servicios de emergencia.
const read = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
describe("aviso de que Dizaster no es un servicio de emergencias", () => {
  it("aparece en la pantalla de emergencia y en Acerca de", () => {
    expect(read("components/emergency-numbers.tsx")).toContain('t("notEmergencyService")');
    expect(read("app/about.tsx")).toContain('t("notEmergencyServiceAbout")');
  });
  it("existe en los cuatro idiomas", () => {
    for (const c of Object.values(CATALOGS)) expect(c.notEmergencyService.length).toBeGreaterThan(40);
  });
});
