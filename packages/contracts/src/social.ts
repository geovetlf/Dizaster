import { z } from "zod";
import type { PublicVerificationState } from "./verification.js";
import type { MediaView } from "./media.js";

export const FeedTab = z.enum(["for_you", "nearby", "following", "videos"]);
export type FeedTab = z.infer<typeof FeedTab>;

export const FeedQuery = z.object({
  tab: FeedTab.default("for_you"),
  /** Código raíz o hoja de categoría (p. ej. "fire" o "fire.structure"). */
  category: z.string().max(80).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  /** Paginación por cursor opaco (fecha + id del último post). */
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(30).default(15),
});
export type FeedQuery = z.infer<typeof FeedQuery>;

/** Autor visible. Si el post es seudónimo no hay nombre ni handle: solo la etiqueta. */
export type PostAuthor =
  | { pseudonymous: false; handle: string; displayName: string }
  | { pseudonymous: true };

export interface FeedPost {
  id: string;
  kind: "STANDARD" | "REPORT" | "SHARE" | "OFFICIAL_UPDATE";
  author: PostAuthor;
  text: string | null;
  createdAt: string;
  categoryCode: string | null;
  /** Evento vinculado y su estado público de verificación (si el post es un reporte o lo menciona). */
  event: { id: string; publicVerificationState: PublicVerificationState } | null;
  /** Distancia aproximada desde el lector, en tramos (nunca exacta). */
  distanceBucket: string | null;
  media: MediaView[];
  /** Media no visible todavía (en proceso o pendiente de moderación). */
  hiddenMediaCount: number;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
}

export interface FeedResponse {
  posts: FeedPost[];
  nextCursor: string | null;
}

export const CreateCommentRequest = z.object({ text: z.string().trim().min(1).max(1000) });

export interface CommentView {
  id: string;
  author: { handle: string; displayName: string };
  text: string;
  createdAt: string;
}
