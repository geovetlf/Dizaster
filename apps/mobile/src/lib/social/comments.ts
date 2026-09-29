import type { CommentView } from "@dizaster/contracts";

/**
 * Orden de lectura con respuestas de un nivel (ADR 0045): cada comentario raíz seguido de sus respuestas, por fecha.
 * Una respuesta cuyo comentario se borró se muestra como raíz.
 */
export function threadComments(comments: readonly CommentView[]): { comment: CommentView; reply: boolean }[] {
  const ids = new Set(comments.map((c) => c.id));
  const replies = new Map<string, CommentView[]>();
  const roots: CommentView[] = [];
  for (const c of comments) {
    if (c.parentId && ids.has(c.parentId)) replies.set(c.parentId, [...(replies.get(c.parentId) ?? []), c]);
    else roots.push(c);
  }
  return roots.flatMap((r) => [{ comment: r, reply: false }, ...(replies.get(r.id) ?? []).map((c) => ({ comment: c, reply: true }))]);
}
