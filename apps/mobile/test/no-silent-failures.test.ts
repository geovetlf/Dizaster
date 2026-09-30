import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CATALOGS } from "../src/lib/i18n";

// ADR 0233: cambios de alertas y cargas de moderación que fallan se dicen; nunca parecen hechos ni vacíos.
const read = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
describe("sin fallos silenciosos en alertas y moderación", () => {
  it("zonas y suscripciones: primero el servidor, y el error se muestra", () => {
    const s = read("app/alert-settings.tsx");
    expect(s).not.toMatch(/removeZone\([^)]*\)\.catch\(/);
    expect(s).not.toMatch(/removeAlertSubscription\([^)]*\)\.catch\(/);
    expect(s).not.toMatch(/addAlertSubscription\([^)]*\)\.catch\(/);
    expect(s.indexOf("await api.removeZone(id)")).toBeLessThan(s.indexOf("deleteZoneMap(id)"));
    expect(s).toContain('t("alertChangeFailed")');
  });
  it("moderación: un fallo de carga muestra error con Reintentar, no la lista vacía", () => {
    expect(read("app/moderation/index.tsx").match(/failed\.(queue|appeals|duplicates) \? <LoadState/g)).toHaveLength(3);
    expect(read("app/my-moderation.tsx")).toContain("<LoadState");
  });
  it("textos en los cuatro idiomas", () => {
    for (const c of Object.values(CATALOGS)) {
      expect(c.alertChangeFailed.length).toBeGreaterThan(5);
      expect(c.noModerationNotices.length).toBeGreaterThan(10);
    }
  });
});
