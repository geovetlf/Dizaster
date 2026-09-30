import { describe, expect, it } from "vitest";
import { SUPPORTED_LANGS } from "../src/common.js";
import {
  fallbackChain, formatCurrency, formatMessage, formatTimeAgo, LANGUAGES, localizedText, pluralCategory, regionOf, resolveLocale,
} from "../src/language-engine.js";

// Language Engine (ADR 0216): todo local y determinístico. NO AI REQUIRED.
describe("registro de idiomas", () => {
  it("cada idioma soportado tiene entrada completa y respaldos soportados", () => {
    for (const l of SUPPORTED_LANGS) {
      const s = LANGUAGES[l];
      expect(s.nativeName.length).toBeGreaterThan(0);
      expect(["ltr", "rtl"]).toContain(s.dir);
      expect(s.defaultLocale.startsWith(l)).toBe(true);
      for (const f of s.fallback) expect(SUPPORTED_LANGS).toContain(f);
    }
    expect(Object.keys(LANGUAGES).sort()).toEqual([...SUPPORTED_LANGS].sort());
  });

  it("plurales CLDR", () => {
    expect([0, 1, 2].map((n) => pluralCategory("es", n))).toEqual(["other", "one", "other"]);
    expect(pluralCategory("es", 1_000_000)).toBe("many");
    expect([0, 1, 1.5, 2].map((n) => pluralCategory("fr", n))).toEqual(["one", "one", "one", "other"]);
    expect([0, 1, 2].map((n) => pluralCategory("pt", n))).toEqual(["one", "one", "other"]);
    expect([0, 1, 2].map((n) => pluralCategory("en", n))).toEqual(["other", "one", "other"]);
  });

  it("cadena de respaldo y texto localizado de datos", () => {
    expect(fallbackChain("pt")).toEqual(["pt", "es", "en"]);
    expect(fallbackChain("es")).toEqual(["es", "en"]);
    expect(localizedText({ es: "Sismo", en: "Earthquake" }, "pt")).toBe("Sismo");
    expect(localizedText({ en: "Earthquake" }, "es")).toBe("Earthquake");
    expect(localizedText({ de: "Erdbeben" }, "es")).toBe("Erdbeben");
    expect(localizedText({ es: "  " }, "es")).toBeNull();
    expect(localizedText(null, "es")).toBeNull();
  });
});

describe("resolveLocale", () => {
  it("elección manual primero, con la región del país", () => {
    expect(resolveLocale({ pref: "en", deviceLocales: ["es-PE"], countryLocale: "es-PE" })).toMatchObject({ lang: "en", locale: "en-PE", source: "user" });
  });
  it("teléfono en español de Perú", () => {
    expect(resolveLocale({ pref: "system", deviceLocales: ["es-PE"] })).toMatchObject({ lang: "es", locale: "es-PE", source: "device", dir: "ltr" });
  });
  it("teléfono en un idioma no soportado: segundo idioma del teléfono y, si no, el del país", () => {
    expect(resolveLocale({ deviceLocales: ["de-DE", "pt-BR"] })).toMatchObject({ lang: "pt", locale: "pt-BR", source: "device" });
    expect(resolveLocale({ deviceLocales: ["de-DE"], countryLocale: "es-PE" })).toMatchObject({ lang: "es", locale: "es-PE", source: "country" });
    expect(resolveLocale({ deviceLocales: ["qu-PE"] })).toMatchObject({ lang: "es", locale: "es-PE", source: "fallback" });
  });
  it("región de etiquetas", () => {
    expect(regionOf("es_PE")).toBe("PE");
    expect(regionOf("zh-Hant-TW")).toBe("TW");
    expect(regionOf("es-419")).toBe("419");
    expect(regionOf("es")).toBeNull();
  });
});

describe("mensajes y formatos", () => {
  const tpl = "{n, plural, =0 {Sin reportes} one {# reporte} other {# reportes}} en {place}";
  it("plural con =0, one y other, y variables", () => {
    expect(formatMessage(tpl, { n: 0, place: "Lima" }, "es")).toBe("Sin reportes en Lima");
    expect(formatMessage(tpl, { n: 1, place: "Lima" }, "es")).toBe("1 reporte en Lima");
    expect(formatMessage(tpl, { n: 1200, place: "Lima" }, "es", "es-PE")).toBe("1,200 reportes en Lima");
    expect(formatMessage("Hola {name}", {}, "es")).toBe("Hola {name}");
  });
  it("moneda y tiempo relativo", () => {
    expect(formatCurrency(12.5, "PEN", "es-PE")).toMatch(/S\/\s?12\.50/);
    expect(formatCurrency(3, "XXX_BAD", "es-PE")).toBe("XXX_BAD 3.00");
    expect(formatTimeAgo(30, "es")).toBe("Ahora");
    expect(formatTimeAgo(720, "es")).toBe("Hace 12 min");
    expect(formatTimeAgo(3 * 3600, "en")).toBe("3 h ago");
    expect(formatTimeAgo(2 * 86_400, "fr")).toBe("Il y a 2 j");
  });
});
