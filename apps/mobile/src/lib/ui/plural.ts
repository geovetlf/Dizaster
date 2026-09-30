import { pluralCategory as cldrPlural, type Lang } from "@dizaster/contracts";

/**
 * Plural de dos formas para `tCount` (ADR 0079): "one" o "other". La regla CLDR de cada idioma vive en el registro
 * del Language Engine (`@dizaster/contracts`, ADR 0216), igual en la app y en el servidor; aquí "many" (un millón
 * en es/pt/fr) usa la forma plural. Para mensajes con más formas, `tf` con `{n, plural, ...}`.
 */
export function pluralCategory(n: number, lang: Lang): "one" | "other" {
  return cldrPlural(lang, n) === "one" ? "one" : "other";
}
