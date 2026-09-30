import type { Sensitivity } from "@dizaster/contracts";

/**
 * Seudónimo por defecto (§13.2, D-05, ADR 0234): en categorías sensibles el interruptor empieza encendido y la
 * persona puede apagarlo; en las muy sensibles es obligatorio (`forcePseudonymous`). NO AI REQUIRED.
 */
export function pseudonymousByDefault(sensitivity: Sensitivity): boolean {
  return sensitivity !== "NORMAL";
}
