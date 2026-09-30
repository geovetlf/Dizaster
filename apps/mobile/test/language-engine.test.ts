import { formatMessage, LANGUAGES, SUPPORTED_LANGS } from "@dizaster/contracts";
import { describe, expect, it } from "vitest";
import { CATALOGS, type MessageKey } from "../src/lib/i18n";

/**
 * Completitud de los textos de la interfaz (Language Engine, ADR 0216). Los textos son locales y versionados; ninguno
 * se traduce con IA. Estas pruebas fallan si un idioma queda con un texto vacío, con otras variables que el
 * español o con un plural mal escrito. NO AI REQUIRED.
 */
const placeholders = (s: string) =>
  [...s.matchAll(/\{\s*(\w+)\s*(?:\}|,\s*plural\s*,)/g)].map((m) => m[1]!).filter((v, i, a) => a.indexOf(v) === i).sort();
const keys = Object.keys(CATALOGS.es) as MessageKey[];

describe("catálogos de la interfaz", () => {
  it("cada idioma del registro tiene catálogo y viceversa", () => {
    expect(Object.keys(CATALOGS).sort()).toEqual([...SUPPORTED_LANGS].sort());
    for (const l of SUPPORTED_LANGS) expect(LANGUAGES[l]).toBeTruthy();
  });

  for (const l of SUPPORTED_LANGS) {
    it(`${l}: sin textos vacíos y con las mismas variables que el español`, () => {
      const empty = keys.filter((k) => !CATALOGS[l][k]?.trim());
      expect(empty).toEqual([]);
      const mismatched = keys.filter((k) => placeholders(CATALOGS[l][k]).join() !== placeholders(CATALOGS.es[k]).join());
      expect(mismatched).toEqual([]);
    });

    it(`${l}: los plurales se resuelven sin dejar llaves`, () => {
      for (const k of keys) {
        const text = CATALOGS[l][k];
        if (!/,\s*plural\s*,/.test(text)) continue;
        const params = Object.fromEntries(placeholders(text).map((p) => [p, 2]));
        for (const n of [0, 1, 2, 5]) {
          const out = formatMessage(text, { ...params, n }, l);
          expect(out, `${l}.${k}`).not.toMatch(/[{}]/);
        }
      }
    });
  }

  it("el plural de reportes pendientes cambia de forma según el número", () => {
    expect(formatMessage(CATALOGS.es.signOutPending, { n: 1 }, "es")).toBe("Tienes 1 reporte sin enviar: se descartará.");
    expect(formatMessage(CATALOGS.es.signOutPending, { n: 3 }, "es")).toBe("Tienes 3 reportes sin enviar: se descartarán.");
    expect(formatMessage(CATALOGS.fr.signOutPending, { n: 0 }, "fr")).toContain("0 signalement non envoyé");
  });
});
