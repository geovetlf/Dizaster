import type { Lang } from "@dizaster/contracts";

/**
 * Categoría plural CLDR para los idiomas de la app (ADR 0079), sin depender de `Intl.PluralRules` (no está en todos
 * los motores de JS del teléfono). Solo cantidades enteras, que es lo que se cuenta en la interfaz.
 * - es, en: "one" solo para 1.
 * - pt (Brasil) y fr: "one" para 0 y 1 ("0 relato", "0 signalement").
 */
export function pluralCategory(n: number, lang: Lang): "one" | "other" {
  const i = Math.floor(Math.abs(n));
  if (lang === "pt" || lang === "fr") return i === 0 || i === 1 ? "one" : "other";
  return n === 1 ? "one" : "other";
}
