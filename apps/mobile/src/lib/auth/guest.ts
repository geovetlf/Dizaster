/**
 * Uso sin cuenta (ADR 0317, ADR 0332): sin sesión solo se lee contenido público. La app no ofrece escribir a quien no
 * tiene cuenta y, si algo se escapa, el 401 del servidor (la barrera real) lleva a «Entrar» en lugar de decir "tu
 * sesión expiró". NO AI REQUIRED.
 */

/** Sin cuenta: la sesión ya arrancó y no hay con qué entrar (producción sin cuenta o una cuenta real sin refresh). */
export const isGuest = (s: { ready: boolean; needsSignIn?: boolean }): boolean => s.ready && s.needsSignIn === true;

/**
 * Una escritura rechazada por falta de sesión. Las lecturas no cuentan: una pantalla que consulta algo de la cuenta
 * no debe abrir «Entrar» por sí sola. Las rutas de autenticación tampoco: su 401 es un código o un refresh inválido.
 */
export function guestWriteRejected(status: number, method: string, path: string, hasToken: boolean): boolean {
  return status === 401 && !hasToken && method.toUpperCase() !== "GET" && !path.startsWith("/v1/auth/");
}

/** Varias peticiones fallan a la vez (o la sesión se pierde y además falla una escritura): «Entrar» se abre una vez. */
export const SIGN_IN_PROMPT_COOLDOWN_MS = 3_000;

export function shouldPromptSignIn(lastPromptAt: number | null, now: number): boolean {
  return lastPromptAt === null || now - lastPromptAt >= SIGN_IN_PROMPT_COOLDOWN_MS;
}
