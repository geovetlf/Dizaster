import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * Accesibilidad (ADR 0198, §11.4). Los cambios de estado importantes (buscando ubicación, sin señal, enviado,
 * guardado sin conexión, errores) se anuncian al lector de pantalla: TalkBack y VoiceOver con la misma llamada.
 */
export function announce(message: string | null | undefined): void {
  if (message && message.trim()) AccessibilityInfo.announceForAccessibility(message);
}

/** Anuncia el texto cada vez que cambia (y no está vacío). */
export function useAnnounce(message: string | null | undefined): void {
  useEffect(() => { announce(message); }, [message]);
}

/** "Reducir movimiento" del sistema: sin animaciones de transición. */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (alive) setReduce(v); }).catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduce);
    return () => { alive = false; sub.remove(); };
  }, []);
  return reduce;
}
