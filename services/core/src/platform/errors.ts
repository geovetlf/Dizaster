/**
 * Detalles opcionales que viajan en el cuerpo del error junto a `error` y `message` (ADR 0340). Solo valores planos,
 * declarados a mano por quien lanza el error y sobre la propia sesión: nunca una fila de base de datos ni datos de
 * terceros. Las claves reservadas (`error`, `message`) nunca se pisan: el manejador las escribe después.
 */
export type ErrorDetails = Readonly<Record<string, string | number | boolean | null>>;

export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus = 400,
    readonly details?: ErrorDetails,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export const notFound = (what: string) => new DomainError("NOT_FOUND", `${what} no encontrado`, 404);
export const forbidden = (why: string) => new DomainError("FORBIDDEN", why, 403);
