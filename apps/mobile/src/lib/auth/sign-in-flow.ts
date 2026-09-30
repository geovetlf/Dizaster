/** Validaciones del inicio de sesión por correo (ADR 0171), iguales a las del servidor. NO AI REQUIRED. */
export function isEmail(value: string): boolean {
  const v = value.trim();
  return v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

/** El código llega con 6 dígitos; se aceptan espacios o guiones al pegarlo. */
export function normalizeCode(value: string): string | null {
  const digits = value.replace(/[\s-]/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}

/**
 * Cómo arrancar la sesión: con refresh guardado se renueva; si no, el acceso de desarrollo cuando el servidor lo
 * tiene; y si no, hace falta iniciar sesión (una cuenta real nunca vuelve a entrar sola sin su refresh).
 */
export function startupPlan(stored: { method?: "DEV" | "REAL"; refreshToken?: string | null } | null): "REFRESH" | "DEV" | "SIGN_IN" {
  if (stored?.refreshToken) return "REFRESH";
  return stored?.method === "REAL" ? "SIGN_IN" : "DEV";
}
