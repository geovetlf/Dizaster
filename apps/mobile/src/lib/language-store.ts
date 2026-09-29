import { File, Paths } from "expo-file-system";
import { lang, locale, setLang } from "./i18n";
import { applyDirection } from "./ui/apply-direction";
import { parseLanguagePref, resolveLang, type LanguagePref } from "./language";

const file = () => new File(Paths.document, "app-language.txt");
const listeners = new Set<() => void>();

/** Lectura síncrona al arrancar, antes de pintar nada (index.ts). Sin archivo o con error: idioma del teléfono. */
export function loadLanguagePref(): LanguagePref {
  try {
    const f = file();
    return f.exists ? parseLanguagePref(f.textSync()) : "system";
  } catch {
    return "system";
  }
}

export function applyLanguagePref(pref: LanguagePref): void {
  setLang(resolveLang(pref, locale));
  // La dirección sigue al idioma de la app, no al del teléfono (ADR 0102).
  applyDirection(lang);
}

/** Guarda, aplica y avisa a la raíz de la app para que vuelva a pintar la navegación en el idioma nuevo. */
export function chooseLanguage(pref: LanguagePref): void {
  try {
    const f = file();
    if (!f.exists) f.create();
    f.write(pref);
  } catch {
    // Si no se puede guardar, igual se aplica en esta sesión.
  }
  applyLanguagePref(pref);
  for (const l of listeners) l();
}

export function onLanguageChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
