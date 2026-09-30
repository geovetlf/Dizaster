import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Contexto de la operación en curso (§6.2, ADR 0172): id de correlación de extremo a extremo y quién la inició.
 * Lo fija la API por petición y el despachador del outbox por evento; `publish()` lo copia en cada evento de dominio
 * sin que los módulos tengan que pasarlo a mano. `actor` es "user:<id>" o "system:<origen>", nunca datos personales.
 */
export interface RequestContext { correlationId: string; actor: string | null }

const storage = new AsyncLocalStorage<RequestContext>();

export function currentContext(): RequestContext | undefined {
  return storage.getStore();
}

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** Id que llega del cliente (`x-request-id`): solo se acepta si es corto y sin caracteres raros; si no, se genera. */
export const REQUEST_ID_HEADER = "x-request-id";
const SAFE_ID = /^[A-Za-z0-9-]{8,64}$/;
export function acceptRequestId(v: unknown): string | null {
  return typeof v === "string" && SAFE_ID.test(v) ? v : null;
}
