import { describe, expect, it } from "vitest";
import { localizedStyleUrl } from "../src/index.js";

// Etiquetas del mapa en el idioma de la app (ADR 0193). NO AI REQUIRED.
describe("localizedStyleUrl", () => {
  it("pone el idioma de la app; uno sin estilo propio usa el primero; sin {lang} no cambia", () => {
    expect(localizedStyleUrl("https://m/style-dark-{lang}.json", "pt")).toBe("https://m/style-dark-pt.json");
    expect(localizedStyleUrl("https://m/style-dark-{lang}.json", "qu")).toBe("https://m/style-dark-es.json");
    expect(localizedStyleUrl("https://m/style.json", "fr")).toBe("https://m/style.json");
  });
});
