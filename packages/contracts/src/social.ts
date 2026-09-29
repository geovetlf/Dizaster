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

/**
 * Autor visible. Si el post es seudónimo no hay nombre ni handle: solo la etiqueta. Si lo publicó un negocio,
 * `business` trae su estado de verificación (y el handle es el del negocio, nunca el de quien lo administra).
 */
export type PostAuthor =
  | { pseudonymous: false; handle: string; displayName: string; business?: { verification: "UNVERIFIED" | "VERIFIED" | "INSTITUTIONAL_OFFICIAL" } }
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
  /** Totales por tipo de reacción (ADR 0040). Solo aparecen los tipos con al menos una. */
  reactions: ReactionCounts;
  /** Reacciones de quien mira (vacío sin sesión). */
  myReactions: ReactionKind[];
  /** Handles mencionados que existen: solo esos se pintan como enlace. */
  mentions: string[];
  /** Subconjunto de `mentions` que son negocios (enlazan a su página, ADR 0054). */
  businessMentions: string[];
  /** Veces que se compartió dentro de la app (ADR 0046). */
  shareCount: number;
  /** Solo en posts SHARE: el original, o `post: null` si ya no está disponible (borrado u oculto). */
  share: { post: FeedPost | null } | null;
  /** La persona que mira es quien lo escribió (puede borrarlo). Nunca revela la autoría de un post seudónimo a otros. */
  mine: boolean;
}

export interface FeedResponse {
  posts: FeedPost[];
  nextCursor: string | null;
}

export const CreateCommentRequest = z.object({
  text: z.string().trim().min(1).max(1000),
  /** Responder a un comentario. Si ese ya es una respuesta, la nueva cuelga del mismo hilo (un nivel). */
  parentId: z.uuid().optional(),
});

export interface CommentView {
  id: string;
  /** Respuesta a otro comentario (un solo nivel, ADR 0045). */
  parentId: string | null;
  author: { handle: string; displayName: string };
  text: string;
  createdAt: string;
  /** Lo escribió quien mira: puede borrarlo. */
  mine: boolean;
  reactions: ReactionCounts;
  myReactions: ReactionKind[];
}

/** Qué se puede seguir en V1 (en la URL): personas, eventos, lugares del índice geográfico y etiquetas. */
export const FollowTarget = z.enum(["profile", "event", "place", "tag", "business"]);
export type FollowTarget = z.infer<typeof FollowTarget>;

/** Perfil público. Nunca incluye los posts seudónimos de la persona ni cuenta con ellos. */
export interface ProfileView {
  handle: string;
  displayName: string;
  /** Biografía pública corta (ADR 0044). */
  bio: string | null;
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
  tags: { tag: string; display: string }[];
  businesses: { handle: string; name: string }[];
}

export const ProfilePostsQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(30).default(15),
});

/**
 * Reacciones de contexto (ADR 0040). "Yo también lo vi" solo existe en posts ligados a un evento y es una señal
 * social: nunca suma evidencia ni cambia la verificación (para eso está el reporte).
 */
export const ReactionKind = z.enum(["LIKE", "SUPPORT", "USEFUL", "SEEN_TOO"]);
export type ReactionKind = z.infer<typeof ReactionKind>;
export type ReactionCounts = Partial<Record<ReactionKind, number>>;
export interface ReactionState { reactions: ReactionCounts; myReactions: ReactionKind[] }
/** En comentarios no hay "yo también lo vi": solo tiene sentido sobre el evento. */
export const CommentReactionKind = z.enum(["LIKE", "SUPPORT", "USEFUL"]);
export type CommentReactionKind = z.infer<typeof CommentReactionKind>;
/** Tipos que se ofrecen según el post: sin evento no hay "yo también lo vi". */
export function reactionKindsFor(post: { event: unknown }): ReactionKind[] {
  return post.event ? ["LIKE", "SUPPORT", "USEFUL", "SEEN_TOO"] : ["LIKE", "SUPPORT", "USEFUL"];
}

export const Units = z.enum(["metric", "imperial"]);
export type Units = z.infer<typeof Units>;

/** Mi perfil: lo público más mis ajustes (ADR 0044). */
export interface MyProfile extends ProfileView {
  units: Units;
  /**
   * País preferido (ISO 3166-1 alfa-2, ADR 0085). Privado. Solo se usa cuando no hay ubicación: números de
   * emergencia y "todo el país" en alertas. `null` = sin elegir.
   */
  country: string | null;
}

/** Cambios de mi perfil. El handle no se cambia en V1: rompería menciones y enlaces compartidos. */
export const UpdateProfileRequest = z
  .object({
    displayName: z.string().trim().min(1).max(50).optional(),
    /** Vacío = quitarla. */
    bio: z.string().trim().max(160).nullable().optional(),
    units: Units.optional(),
    /** `null` = quitarlo. El servidor comprueba que exista en el dataset de fronteras. */
    country: z.string().regex(/^[A-Z]{2}$/).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nada que cambiar");
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequest>;
