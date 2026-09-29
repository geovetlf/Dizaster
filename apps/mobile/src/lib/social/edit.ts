import type { FeedPost } from "@dizaster/contracts";

/** Editar un post (ADR 0136): solo si el servidor dio un plazo y todavía no venció. Lógica común a Android e iOS. */
export function canEditPost(post: Pick<FeedPost, "editableUntil">, now = new Date()): boolean {
  return !!post.editableUntil && Date.parse(post.editableUntil) > now.getTime();
}
