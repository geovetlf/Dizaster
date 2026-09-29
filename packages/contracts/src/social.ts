import { z } from "zod";
import type { PublicVerificationState } from "./verification.js";
import type { MediaView } from "./media.js";
import type { ContextualLocation } from "./geo.js";

export const FeedTab = z.enum(["for_you", "nearby", "following", "videos"]);
export type FeedTab = z.infer<typeof FeedTab>;

export const FeedQuery = z.object({
  tab: FeedTab.default("for_you"),
  /** Código raíz o hoja de categoría (p. ej. "fire" o "fire.structure"). */
  category: z.string().max(80).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  /** Paginación por cursor opaco (puntuación de orden + id del último post). */
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
  /** Lugar contextual del evento vinculado ("Miraflores, Lima"); nunca la ubicación del autor. */
  place: ContextualLocation | null;
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

/** Qué se puede seguir en V1 (en la URL): personas, eventos y lugares del índice geográfico. */
export const FollowTarget = z.enum(["profile", "event", "place"]);
export type FollowTarget = z.infer<typeof FollowTarget>;

/** Perfil público. Nunca incluye los posts seudónimos de la persona ni cuenta con ellos. */
export interface ProfileView {
  handle: string;
  displayName: string;
  createdAt: string;
  followerCount: number;
  followingCount: number;
  postCount: number;
  followedByMe: boolean;
  /** Bloqueaste a esta persona: sus posts y comentarios con nombre no te aparecen. */
  blockedByMe: boolean;
  isMe: boolean;
}

export const ProfileSearchQuery = z.object({
  q: z.string().trim().min(2).max(40),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

export interface ProfileSearchResult {
  handle: string;
  displayName: string;
  followerCount: number;
  followedByMe: boolean;
}

export interface MyFollows {
  profiles: { handle: string; displayName: string }[];
  events: { id: string }[];
  places: { id: string; name: string; label: string }[];
}

export const ProfilePostsQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(30).default(15),
});
