/**
 * Páginas con cursor (ADR 0106). NO AI REQUIRED.
 * `appendPage` añade una página sin repetir lo que ya estaba (p. ej. un comentario recién publicado que vuelve en la
 * página siguiente); `newestFirst` ordena la timeline de lo más reciente a lo más antiguo, venga de donde venga
 * (también de una copia guardada sin conexión con el orden antiguo).
 */
export function appendPage<T extends { id: string }>(prev: readonly T[], next: readonly T[]): T[] {
  const seen = new Set(prev.map((x) => x.id));
  return [...prev, ...next.filter((x) => !seen.has(x.id))];
}

export function newestFirst<T extends { id: string; at: string }>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => (a.at === b.at ? (a.id < b.id ? 1 : a.id > b.id ? -1 : 0) : a.at < b.at ? 1 : -1));
}

/** Query string de una página: `?limit=…&order=…&cursor=…` solo con lo que viene. */
export function pageQuery(p: { cursor?: string | null; limit?: number; order?: "asc" | "desc" }): string {
  const q = new URLSearchParams();
  if (p.limit) q.set("limit", String(p.limit));
  if (p.order) q.set("order", p.order);
  if (p.cursor) q.set("cursor", p.cursor);
  const s = q.toString();
  return s ? `?${s}` : "";
}
