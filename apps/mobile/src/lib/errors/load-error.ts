/**
 * Por qué no cargó una pantalla (ADR 0212): lo borrado o inexistente no se arregla reintentando; sin red, sí.
 * `status` lo pone `api.request`; sin `status` no hubo respuesta del servidor. NO AI REQUIRED.
 */
export type LoadErrorKind = "notFound" | "offline" | "failed";

export function classifyLoadError(e: unknown): LoadErrorKind {
  const status = (e as { status?: unknown } | null)?.status;
  if (status === 404 || status === 410) return "notFound";
  if (typeof status !== "number") return "offline";
  return "failed";
}
