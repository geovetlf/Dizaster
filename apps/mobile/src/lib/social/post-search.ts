import type { PostAuthor } from "@dizaster/contracts";

/** Mínimo de letras para buscar publicaciones (igual que el servidor, ADR 0107). */
export const POST_SEARCH_MIN = 3;

/**
 * Fragmento de una publicación para la lista de resultados (ADR 0107): una línea, sin saltos, cortada en una
 * palabra y centrada en lo buscado si aparece más adelante. NO AI REQUIRED.
 */
export function postSnippet(text: string | null, query: string, max = 90): string {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const hit = flat.toLowerCase().indexOf(query.trim().toLowerCase());
  let start = hit > max / 2 ? hit - Math.floor(max / 3) : 0;
  if (start > 0) {
    const space = flat.indexOf(" ", start);
    start = space >= 0 && space < hit ? space + 1 : start;
  }
  let piece = flat.slice(start, start + max);
  if (start + max < flat.length) {
    const cut = piece.lastIndexOf(" ");
    piece = `${cut > max / 2 ? piece.slice(0, cut) : piece}…`;
  }
  return `${start > 0 ? "…" : ""}${piece}`;
}

/** Quién firma el resultado: nombre visible o el texto de seudónimo. */
export function postAuthorLabel(author: PostAuthor, pseudonym: string): string {
  return author.pseudonymous ? pseudonym : author.displayName;
}
