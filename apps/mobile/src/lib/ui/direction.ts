import { baseLanguage, isSupportedLang, LANGUAGES } from "@dizaster/contracts";

/**
 * Dirección de escritura (Blueprint §5.15, ADR 0102). Hoy la app no tiene idiomas RTL, pero el diseño queda listo:
 * estilos con start/end, iconos de avance que se invierten y la dirección fijada según el idioma de la app, no el
 * del teléfono (un teléfono en árabe con la app en español no debe verse espejado). NO AI REQUIRED.
 */
export const RTL_LANGS = ["ar", "he", "fa", "ur", "yi", "ps", "sd", "ug", "dv", "ckb"] as const;

/** Para idiomas de la app manda el registro del Language Engine (ADR 0216); para el resto, la lista conocida. */
export function isRtlLang(lang: string): boolean {
  const base = baseLanguage(lang);
  if (isSupportedLang(base)) return LANGUAGES[base].dir === "rtl";
  return (RTL_LANGS as readonly string[]).includes(base);
}

/** Qué dirección corresponde y si hay que reiniciar para aplicarla (React Native la fija al arrancar). */
export function directionFor(lang: string, currentlyRtl: boolean): { rtl: boolean; needsRestart: boolean } {
  const rtl = isRtlLang(lang);
  return { rtl, needsRestart: rtl !== currentlyRtl };
}

/** Icono de "ir hacia adelante" (filas que abren otra pantalla): apunta al final de la línea. */
export const forwardChevron = (rtl: boolean): "chevron-right" | "chevron-left" => (rtl ? "chevron-left" : "chevron-right");
