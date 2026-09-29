import { langFromLocale, SUPPORTED_LANGS, type Lang } from "@dizaster/contracts";

/** Idioma elegido en el perfil (ADR 0069). "system" = el del teléfono. */
export type LanguagePref = Lang | "system";

export const LANGUAGE_OPTIONS: readonly LanguagePref[] = ["system", ...SUPPORTED_LANGS];

/** Cada idioma se nombra en sí mismo: quien no entiende el idioma actual encuentra el suyo. */
export const LANGUAGE_NAMES: Record<Lang, string> = { es: "Español", en: "English", pt: "Português", fr: "Français" };

export function resolveLang(pref: LanguagePref, deviceLocale: string | null | undefined): Lang {
  return pref === "system" ? langFromLocale(deviceLocale) : pref;
}

/** Lo guardado puede venir de una versión con otros idiomas: cualquier cosa desconocida es "system". */
export function parseLanguagePref(raw: unknown): LanguagePref {
  const v = typeof raw === "string" ? raw.trim() : "";
  return (LANGUAGE_OPTIONS as readonly string[]).includes(v) ? (v as LanguagePref) : "system";
}

/**
 * Nombre del idioma de un texto si no es el de la app (ADR 0091): "Escrito en English". Sin idioma detectado, o
 * en uno que la app no conoce, no se dice nada. NO AI REQUIRED.
 */
export function foreignLanguageName(textLang: string | null | undefined, appLang: Lang): string | null {
  if (!textLang || textLang === appLang) return null;
  return (LANGUAGE_NAMES as Record<string, string>)[textLang] ?? null;
}
