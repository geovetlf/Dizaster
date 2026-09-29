export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus = 400,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export const notFound = (what: string) => new DomainError("NOT_FOUND", `${what} no encontrado`, 404);
export const forbidden = (why: string) => new DomainError("FORBIDDEN", why, 403);
