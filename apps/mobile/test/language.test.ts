import { describe, expect, it } from "vitest";
import { LANGUAGE_NAMES, LANGUAGE_OPTIONS, parseLanguagePref, resolveLang } from "../src/lib/language";

describe("idioma elegible (ADR 0069)", () => {
  it("'del teléfono' sigue el idioma del sistema; si no está soportado, español", () => {
    expect(resolveLang("system", "pt-BR")).toBe("pt");
    expect(resolveLang("system", "de-DE")).toBe("es");
    expect(resolveLang("fr", "en-US")).toBe("fr");
  });

  it("lo guardado desconocido o dañado vuelve a 'del teléfono'", () => {
    expect(parseLanguagePref("en")).toBe("en");
    expect(parseLanguagePref(" fr\n")).toBe("fr");
    expect(parseLanguagePref("de")).toBe("system");
    expect(parseLanguagePref(null)).toBe("system");
  });

  it("todas las opciones tienen nombre en su propio idioma", () => {
    expect(LANGUAGE_OPTIONS[0]).toBe("system");
    for (const o of LANGUAGE_OPTIONS) if (o !== "system") expect(LANGUAGE_NAMES[o]).toBeTruthy();
  });
});
