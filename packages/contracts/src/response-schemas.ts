import { z } from "zod";
import { AlertKind, AlertMatch, SavedZoneKind, type CategorySubscription, type NotificationView, type NotificationsResponse, type SavedZone } from "./alert.js";
import { DevicePlatform, type SessionView } from "./device.js";
import { ContextualLocation } from "./geo.js";
import { LegalDocumentKind, type PolicyStatusResponse } from "./legal.js";
import { ContentWarning, MediaKind, type MediaView } from "./media.js";
import { ReportAssertion, type MyReportView, type MyReportsResponse } from "./report.js";
import {
  MentionsFrom,
  ReactionKind,
  Units,
  type CommentView,
  type FeedPost,
  type FeedResponse,
  type MyFollows,
  type MyProfile,
  type PostAuthor,
  type ProfileSearchResult,
  type ProfileView,
  type ReactionState,
} from "./social.js";
import type { TagView } from "./social-text.js";
import { PublicVerificationState } from "./verification.js";

/**
 * Esquemas zod de las respuestas que el contrato publica como interfaces de TypeScript (ADR 0342). La interfaz sigue
 * siendo la fuente que tipa la app; cada esquema de aquí se comprueba en compilación contra ella (igualdad en los dos
 * sentidos), así que no puede desincronizarse. Sirven para validar en pruebas lo que el backend emite de verdad y para
 * documentar la respuesta en OpenAPI.
 */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
/** Falla la compilación si el esquema y la interfaz difieren en cualquier campo (de más, de menos u opcionalidad). */
function sameAs<T>() {
  return <S extends z.ZodType>(schema: S & (Same<z.infer<S>, T> extends true ? unknown : { __contractMismatch: T })): S => schema;
}

const iso = z.string();
const ReactionCounts = z.partialRecord(ReactionKind, z.number().int());

export const MediaViewSchema = sameAs<MediaView>()(z.object({
  id: z.string(),
  kind: MediaKind,
  mime: z.string(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  durationMs: z.number().nullable(),
  capturedInApp: z.boolean(),
  url: z.string(),
  thumbUrl: z.string().nullable(),
  posterUrl: z.string().nullable(),
  contentWarning: ContentWarning.nullable(),
}));

export const PostAuthorSchema = sameAs<PostAuthor>()(z.discriminatedUnion("pseudonymous", [
  z.object({
    pseudonymous: z.literal(false),
    handle: z.string(),
    displayName: z.string(),
    avatarUrl: z.string().nullable().optional(),
    business: z.object({ verification: z.enum(["UNVERIFIED", "VERIFIED", "INSTITUTIONAL_OFFICIAL"]) }).optional(),
  }),
  z.object({ pseudonymous: z.literal(true) }),
]));

const FeedPostBase = sameAs<Omit<FeedPost, "share">>()(z.object({
  id: z.string(),
  kind: z.enum(["STANDARD", "REPORT", "SHARE", "OFFICIAL_UPDATE"]),
  author: PostAuthorSchema,
  text: z.string().nullable(),
  lang: z.string().nullable(),
  createdAt: iso,
  categoryCode: z.string().nullable(),
  event: z.object({ id: z.string(), publicVerificationState: PublicVerificationState }).nullable(),
  place: ContextualLocation.nullable(),
  distanceBucket: z.string().nullable(),
  media: z.array(MediaViewSchema),
  hiddenMediaCount: z.number().int(),
  likeCount: z.number().int(),
  commentCount: z.number().int(),
  likedByMe: z.boolean(),
  reactions: ReactionCounts,
  myReactions: z.array(ReactionKind),
  mentions: z.array(z.string()),
  businessMentions: z.array(z.string()),
  shareCount: z.number().int(),
  externalShareCount: z.number().int(),
  mine: z.boolean(),
  editedAt: iso.nullable().optional(),
  editableUntil: iso.nullable().optional(),
}));
/** Un post SHARE trae el original anidado (o `null` si ya no está disponible). */
export const FeedPostSchema: z.ZodType<FeedPost> = FeedPostBase.extend({
  share: z.object({ post: z.lazy(() => FeedPostSchema).nullable() }).nullable(),
});

export const FeedResponseSchema = sameAs<FeedResponse>()(z.object({ posts: z.array(FeedPostSchema), nextCursor: z.string().nullable() }));

export const CommentViewSchema = sameAs<CommentView>()(z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  author: z.object({ handle: z.string(), displayName: z.string(), avatarUrl: z.string().nullable().optional() }),
  text: z.string(),
  createdAt: iso,
  mine: z.boolean(),
  reactions: ReactionCounts,
  myReactions: z.array(ReactionKind),
}));
/** GET /v1/posts/:id/comments (ADR 0106). */
export const CommentsPageSchema = z.object({ comments: z.array(CommentViewSchema), nextCursor: z.string().nullable() });

export const ReactionStateSchema = sameAs<ReactionState>()(z.object({ reactions: ReactionCounts, myReactions: z.array(ReactionKind) }));

const profileShape = {
  handle: z.string(),
  displayName: z.string(),
  bio: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  createdAt: iso,
  followerCount: z.number().int(),
  followingCount: z.number().int(),
  postCount: z.number().int(),
  followedByMe: z.boolean(),
  blockedByMe: z.boolean(),
  isMe: z.boolean(),
  corroboratedReports: z.object({ total: z.number().int(), official: z.number().int() }).nullable(),
};
export const ProfileViewSchema = sameAs<ProfileView>()(z.object(profileShape));
export const MyProfileSchema = sameAs<MyProfile>()(z.object({
  ...profileShape,
  units: Units,
  country: z.string().nullable(),
  mentionsFrom: MentionsFrom,
  showCorroboratedReports: z.boolean(),
}));

export const ProfileSearchResultSchema = sameAs<ProfileSearchResult>()(z.object({
  handle: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable().optional(),
  followerCount: z.number().int(),
  followedByMe: z.boolean(),
}));

export const MyFollowsSchema = sameAs<MyFollows>()(z.object({
  profiles: z.array(z.object({ handle: z.string(), displayName: z.string() })),
  events: z.array(z.object({ id: z.string(), title: z.record(z.string(), z.string()).nullable(), categoryCode: z.string(), status: z.string() })),
  places: z.array(z.object({ id: z.string(), name: z.string(), label: z.string() })),
  tags: z.array(z.object({ tag: z.string(), display: z.string() })),
  businesses: z.array(z.object({ handle: z.string(), name: z.string() })),
}));

export const TagViewSchema = sameAs<TagView>()(z.object({
  tag: z.string(),
  display: z.string(),
  postCount: z.number().int(),
  followerCount: z.number().int(),
  followedByMe: z.boolean(),
}));

export const MyReportViewSchema = sameAs<MyReportView>()(z.object({
  id: z.string(),
  postId: z.string().nullable(),
  eventId: z.string().nullable(),
  categoryCode: z.string(),
  assertion: ReportAssertion,
  status: z.enum(["ACCEPTED", "DOWNGRADED", "WITHDRAWN"]),
  capturedAt: iso,
  receivedAt: iso,
  capturedOffline: z.boolean(),
  preciseLocationRemovesAt: iso.nullable(),
  preciseLocationRemovedAt: iso.nullable(),
  presenceReviews: z.number().int(),
  askSameEvent: z.boolean(),
}));
export const MyReportsResponseSchema = sameAs<MyReportsResponse>()(z.object({ reports: z.array(MyReportViewSchema), nextCursor: z.string().nullable() }));

export const NotificationViewSchema = sameAs<NotificationView>()(z.object({
  id: z.string(),
  kind: AlertKind,
  match: AlertMatch,
  eventId: z.string().nullable(),
  postId: z.string().nullable(),
  categoryCode: z.string().nullable(),
  title: z.string(),
  body: z.string(),
  url: z.string(),
  createdAt: iso,
  readAt: iso.nullable(),
  delivery: z.enum(["PENDING", "SENT", "GROUPED", "SILENT_RATE_LIMIT", "SILENT_QUIET_HOURS", "NO_DEVICE", "FAILED", "EXPIRED"]),
  origin: z.enum(["OFFICIAL", "SYSTEM"]),
  expiresAt: iso.nullable(),
  capRef: z.string().nullable(),
}));
export const NotificationsResponseSchema = sameAs<NotificationsResponse>()(z.object({
  notifications: z.array(NotificationViewSchema),
  unread: z.number().int(),
  nextCursor: z.string().nullable(),
}));

export const SavedZoneSchema = sameAs<SavedZone>()(z.object({
  id: z.string(),
  kind: SavedZoneKind,
  name: z.string().nullable(),
  center: z.object({ lat: z.number(), lng: z.number() }),
  radiusKm: z.number(),
  minSeverity: z.number().int(),
  categories: z.array(z.string()),
}));

export const CategorySubscriptionSchema = sameAs<CategorySubscription>()(z.object({
  id: z.string(),
  categoryCode: z.string(),
  areaId: z.string(),
  areaName: z.string(),
  minSeverity: z.number().int(),
}));

export const SessionViewSchema = sameAs<SessionView>()(z.object({
  id: z.string(),
  platform: DevicePlatform.nullable(),
  appVersion: z.string().nullable(),
  startedAt: iso,
  lastActiveAt: iso,
  current: z.boolean(),
}));

export const PolicyStatusResponseSchema = sameAs<PolicyStatusResponse>()(z.object({
  documents: z.array(z.object({
    kind: LegalDocumentKind,
    version: z.string(),
    url: z.string(),
    required: z.boolean(),
    acceptedVersion: z.string().nullable(),
    pending: z.boolean(),
  })),
}));
