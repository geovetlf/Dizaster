/**
 * Segundo factor del personal (ADR 0090). NO AI REQUIRED.
 * El servidor responde 403 con uno de estos códigos cuando una herramienta de moderación o administración necesita MFA.
 */
export const MFA_ERRORS = ["MFA_REQUIRED", "MFA_ENROLLMENT_REQUIRED"] as const;

export function isMfaError(body: unknown): boolean {
  const code = (body as { error?: unknown } | null)?.error;
  return typeof code === "string" && (MFA_ERRORS as readonly string[]).includes(code);
}

/** Solo dígitos, como mucho 6 (lo que escribe o pega la persona desde su app de autenticación). */
export const cleanTotp = (s: string) => s.replace(/\D/g, "").slice(0, 6);

/** El secreto en grupos de 4 para copiarlo a mano sin errores. */
export const groupSecret = (s: string) => s.replace(/(.{4})/g, "$1 ").trim();
