import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CATALOGS, type MessageKey } from "../src/lib/i18n";
import { checkRegionalOverrides, regionalText, type RegionalOverrides } from "../src/lib/locales/regional";
import { actionReasonText } from "../src/lib/moderation/logic";

// Textos regionales (ADR 0281): dato versionado, validado contra el catálogo, sin IA.
const shipped = JSON.parse(readFileSync(resolve(__dirname, "../../../data/locales/ui-regional.json"), "utf8")) as RegionalOverrides;
const sample: RegionalOverrides = { version: "t", overrides: { "es-PE": { send: "Mandar reporte" }, "es-AR": { send: "  " } } };

describe("textos regionales", () => {
  it("el archivo versionado es válido y hoy no ajusta nada (nada se inventa)", () => {
    expect(checkRegionalOverrides(shipped, CATALOGS)).toEqual([]);
    expect(shipped.overrides).toEqual({});
  });

  it("usa el texto del país solo para ese locale exacto", () => {
    expect(regionalText(sample, "es-PE", "send")).toBe("Mandar reporte");
    expect(regionalText(sample, "es-MX", "send")).toBeUndefined();
    expect(regionalText(sample, "es", "send")).toBeUndefined();
    expect(regionalText(sample, "en-PE", "send")).toBeUndefined();
    expect(regionalText(sample, "es-PE", "emergency")).toBeUndefined();
  });

  it("un texto vacío no reemplaza al del idioma", () => {
    expect(regionalText(sample, "es-AR", "send")).toBeUndefined();
  });

  it("rechaza locales mal formados, idiomas no soportados, claves inexistentes, vacíos y variables distintas", () => {
    const bad: RegionalOverrides = {
      version: "t",
      overrides: {
        "es_PE": { send: "x" },
        "qu-PE": { send: "x" },
        "es-PE": { noExiste: "x", send: "", costKillSwitchA11y: "Función {nombre}" },
        "en-GB": { costKillSwitchA11y: "Paid feature {feature}" },
      },
    };
    const errors = checkRegionalOverrides(bad, CATALOGS);
    expect(errors).toHaveLength(5);
    expect(errors.join("\n")).toMatch(/es_PE: locale mal formado/);
    expect(errors.join("\n")).toMatch(/qu-PE: idioma qu no soportado/);
    expect(errors.join("\n")).toMatch(/es-PE.noExiste: la clave no existe/);
    expect(errors.join("\n")).toMatch(/es-PE.send: texto vacío/);
    expect(errors.join("\n")).toMatch(/es-PE.costKillSwitchA11y: variables \{nombre\} distintas de \{feature\}/);
  });
});

describe("motivos de moderación automática", () => {
  const tr = (k: MessageKey) => `[${k}]`;
  const rule = { actor: "RULE" as const, action: "LIMIT" as const, reason: "Limitado automáticamente tras 5 denuncias" };

  it("en español muestra el motivo del servidor, que trae el número de denuncias", () => {
    expect(actionReasonText(rule, "es", tr)).toBe(rule.reason);
  });

  it("en otro idioma nunca muestra el texto en español de la regla", () => {
    expect(actionReasonText(rule, "en", tr)).toBe("[ruleReason_LIMIT]");
    expect(actionReasonText({ ...rule, action: "HIDE" }, "fr", tr)).toBe("[ruleReason_HIDE]");
    expect(actionReasonText({ ...rule, action: "REMOVE" }, "pt", tr)).toBe("[ruleReason_OTHER]");
  });

  it("el motivo de un moderador es texto libre y se muestra tal cual", () => {
    expect(actionReasonText({ actor: "MODERATOR", action: "LIMIT", reason: "Spam repetido" }, "en", tr)).toBe("Spam repetido");
  });

  it("los textos de las reglas existen en los cuatro idiomas", () => {
    for (const lang of ["es", "en", "pt", "fr"] as const)
      for (const k of ["ruleReason_LIMIT", "ruleReason_HIDE", "ruleReason_OTHER"] as const) expect(CATALOGS[lang][k]).toBeTruthy();
  });
});
