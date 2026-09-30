import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CATALOGS } from "../src/lib/i18n";

// Cómo ayudar (D-15, ADR 0274): enlaces externos a organizaciones verificadas; la app no maneja dinero.
const screen = readFileSync(new URL("../src/app/event/[id].tsx", import.meta.url), "utf8");
describe("donaciones en la ficha del evento", () => {
  it("solo enlaces que se abren fuera de la app, y solo si hay organizaciones", () => {
    expect(screen).toContain("donations.length > 0 ?");
    expect(screen).toContain("Linking.openURL(d.url)");
    expect(screen).not.toMatch(/WebView|payment|pago/i);
  });
  it("textos en los cuatro idiomas", () => {
    for (const c of Object.values(CATALOGS)) {
      expect(c.howToHelp.length).toBeGreaterThan(3);
      expect(c.howToHelpNote.length).toBeGreaterThan(30);
    }
  });
});
