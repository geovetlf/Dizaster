import { I18nManager } from "react-native";
import { directionFor } from "./direction";

/**
 * Fija la dirección según el idioma de la app (ADR 0102). Si cambia, vale desde el próximo arranque: React Native
 * no reordena una interfaz ya pintada. Devuelve si hace falta reiniciar.
 */
export function applyDirection(lang: string): boolean {
  const d = directionFor(lang, I18nManager.isRTL);
  try {
    I18nManager.allowRTL(d.rtl);
    I18nManager.forceRTL(d.rtl);
  } catch {
    // En pruebas o en plataformas sin I18nManager no hay nada que fijar.
  }
  return d.needsRestart;
}

export const isRtlNow = () => I18nManager.isRTL;
