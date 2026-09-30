import { SUPPORTED_LANGS } from "@dizaster/contracts";

/**
 * Textos de la interfaz por país dentro de un idioma (ADR 0281): "es-PE" puede decir algo distinto que "es-AR" sin
 * crear otro idioma. Es dato (`data/locales/ui-regional.json`), no código, y se valida contra el catálogo base.
 * NO AI REQUIRED: nada se traduce en tiempo de ejecución.
 */
export interface RegionalOverrides {
  version: string;
  overrides: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

const LOCALE = /^([a-z]{2,3})-([A-Z]{2})$/;
const vars = (s: string) => [...new Set([...s.matchAll(/\{(\w+)/g)].map((m) => m[1]))].sort().join(",");

/** Texto regional para `locale` ("es-PE") y `key`, o `undefined` si no hay (se usa el del idioma). */
export function regionalText(data: RegionalOverrides, locale: string, key: string): string | undefined {
  const m = LOCALE.exec(locale);
  if (!m) return undefined;
  const text = data.overrides[`${m[1]}-${m[2]}`]?.[key];
  return typeof text === "string" && text.trim() ? text : undefined;
}

/**
 * Errores del archivo de textos regionales: locale mal formado o de un idioma no soportado, clave que no existe,
 * texto vacío o con variables distintas de las del texto base del mismo idioma.
 */
export function checkRegionalOverrides(
  data: RegionalOverrides,
  base: Readonly<Record<string, Readonly<Record<string, string>>>>,
): string[] {
  const errors: string[] = [];
  for (const [locale, texts] of Object.entries(data.overrides)) {
    const m = LOCALE.exec(locale);
    if (!m) { errors.push(`${locale}: locale mal formado (se espera idioma-REGIÓN, p. ej. es-PE)`); continue; }
    const lang = m[1]!;
    if (!(SUPPORTED_LANGS as readonly string[]).includes(lang)) { errors.push(`${locale}: idioma ${lang} no soportado`); continue; }
    for (const [key, text] of Object.entries(texts)) {
      const ref = base[lang]?.[key];
      if (ref === undefined) errors.push(`${locale}.${key}: la clave no existe en el catálogo`);
      else if (typeof text !== "string" || !text.trim()) errors.push(`${locale}.${key}: texto vacío`);
      else if (vars(text) !== vars(ref)) errors.push(`${locale}.${key}: variables {${vars(text)}} distintas de {${vars(ref)}}`);
    }
  }
  return errors;
}
