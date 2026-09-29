import {
  POST_EDIT_WINDOW_HOURS,
  FeedQuery,
  FollowTarget,
  PostSearchQuery,
  SetAvatarRequest,
  ProfilePostsQuery,
  ProfileSearchQuery,
  TagParam,
  TagSearchQuery,
  UpdateProfileRequest,
  normalizeTag,
  type FeedPost,
  type TagView,
  type FeedResponse,
  type BusinessView,
  type MediaView,
  type MyFollows,
  type MyProfile,
  type ProfileSearchResult,
  type ProfileView,
  type Sensitivity,
} from "@dizaster/contracts";
import { z } from "zod";
import type { Queryable } from "../../platform/db.js";
import { DomainError } from "../../platform/errors.js";
import type { OutboxDispatcher } from "../../platform/outbox.js";
import type { EventService } from "../event/index.js";
import type { GeoService } from "../geo/index.js";
import type { MediaService } from "../media/index.js";
import type { ReferenceData } from "../reference/index.js";
import type { BusinessService, FeedFilter, FeedRow, FollowType, SocialService } from "../social/index.js";

/** Radio de "cerca de ti" (sobre ubicaciones públicas ya generalizadas). */
export const NEARBY_RADIUS_M = 25_000;

const FOLLOW_TYPE: Record<FollowTarget, FollowType> = { profile: "PROFILE", event: "EVENT", place: "PLACE", tag: "TAG", business: "BUSINESS" };
/** Solo ids de evento válidos llegan a la consulta (un seguimiento viejo con id raro no rompe la lista). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Feed: compone posts (social), estado de verificación (event), lugar (event/geo) y media saneada (media) sin que
 * ningún módulo lea el esquema de otro. La media de categorías sensibles solo aparece si moderación la aprobó.
 * También mantiene la proyección de señales de eventos que social usa para ordenar, y valida a quién se sigue.
 */
/** En categorías muy sensibles (violencia, salud personal) toda media aprobada se muestra con aviso (ADR 0035). */
export function withWarning(media: MediaView[], sensitivity: Sensitivity): MediaView[] {
  return sensitivity === "HIGHLY_SENSITIVE" ? media.map((m) => ({ ...m, contentWarning: m.contentWarning ?? "GRAPHIC" })) : media;
}

export class FeedService {
  constructor(
    private readonly social: SocialService,
    private readonly events: EventService,
    private readonly media: MediaService,
    private readonly ref: ReferenceData,
    private readonly geo: GeoService,
    private readonly business: BusinessService,
  ) {}

  registerHandlers(dispatcher: OutboxDispatcher): void {
    const refresh = async (eventId: string, tx: Queryable) => {
      const s = (await this.events.publicStates(tx, [eventId])).get(eventId);
      if (!s) return;
      await this.social.upsertEventSignal(tx, {
        eventId, severity: s.severity, publicState: s.publicVerificationState, regionId: s.regionId, districtId: s.districtId,
      });
    };
    dispatcher.on("EventCreated", "feed.event-signals.created", (e, tx) => refresh(e.payload.eventId, tx));
    dispatcher.on("EventEvidenceAdded", "feed.event-signals.evidence", (e, tx) => refresh(e.payload.eventId, tx));
    // Resuelto o archivado: sus posts dejan de empujar en "Para ti" (ADR 0124).
    dispatcher.on("EventLifecycleChanged", "feed.event-signals.lifecycle", async (e, tx) => {
      await this.social.upsertEventSignal(tx, { eventId: e.payload.eventId, lifecycle: e.payload.to });
    });
    // El estado viene en el propio evento de dominio: no depende de que el espejo de event ya se haya aplicado.
    dispatcher.on("VerificationChanged", "feed.event-signals.verification", async (e, tx) => {
      const n = e.payload.negativeState;
      await this.social.upsertEventSignal(tx, { eventId: e.payload.eventId, publicState: n === "FALSE" || n === "DISPUTED" ? n : e.payload.to });
    });
  }

  async feed(q: Queryable, rawQuery: unknown, viewerProfileId: string | null): Promise<FeedResponse> {
    const f = parse(FeedQuery, rawQuery);
    const near = f.lat !== undefined && f.lng !== undefined ? { lat: f.lat, lng: f.lng } : undefined;
    return this.page(q, {
      tab: f.tab,
      ...(f.category ? { category: f.category } : {}),
      ...(near ? { near } : {}),
      nearRadiusM: NEARBY_RADIUS_M,
      ...(f.cursor ? { cursor: decodeCursor(f.cursor) } : {}),
      limit: f.limit,
      viewerProfileId,
    });
  }

  /** Página de un perfil: solo sus posts con autoría pública (los seudónimos nunca se vinculan a la persona). */
  async profilePosts(q: Queryable, handle: string, rawQuery: unknown, viewerProfileId: string | null): Promise<FeedResponse> {
    const f = parse(ProfilePostsQuery, rawQuery);
    const authorProfileId = await this.social.profileIdByHandle(q, handle);
    return this.page(q, {
      tab: "for_you", authorProfileId, ...(f.cursor ? { cursor: decodeCursor(f.cursor) } : {}), limit: f.limit, viewerProfileId,
    });
  }

  /**
   * Una publicación por enlace (ADR 0083): mismas reglas que el feed (pública, visible, bloqueos, negocio activo),
   * así un enlace compartido nunca muestra lo que el feed escondería. Si no se puede ver, 404.
   */
  async post(q: Queryable, postId: string, viewerProfileId: string | null): Promise<FeedPost> {
    const rows = await this.social.feed(q, { tab: "for_you", ids: [postId], limit: 1, viewerProfileId });
    const [post] = await this.compose(q, rows, viewerProfileId);
    if (!post) throw new DomainError("NOT_FOUND", "Publicación no disponible", 404);
    return post;
  }

  /** Página de un negocio: sus posts, por recientes. */
  async businessPosts(q: Queryable, handle: string, rawQuery: unknown, viewerProfileId: string | null): Promise<FeedResponse> {
    const f = parse(ProfilePostsQuery, rawQuery);
    const authorBusinessId = await this.business.idByHandle(q, handle);
    return this.page(q, { tab: "for_you", authorBusinessId, ...(f.cursor ? { cursor: decodeCursor(f.cursor) } : {}), limit: f.limit, viewerProfileId });
  }

  /**
   * Búsqueda de publicaciones por texto (ADR 0107): las mismas reglas del feed (públicas, visibles, bloqueos,
   * negocio activo, retraso de publicación), por recientes. Sin IA ni motor externo: trigram de PostgreSQL.
   */
  async searchPosts(q: Queryable, rawQuery: unknown, viewerProfileId: string | null): Promise<FeedResponse> {
    const f = parse(PostSearchQuery, rawQuery);
    return this.page(q, { tab: "for_you", text: f.q, ...(f.cursor ? { cursor: decodeCursor(f.cursor) } : {}), limit: f.limit, viewerProfileId });
  }

  /** Posts públicos con una etiqueta, por recientes. */
  async tagPosts(q: Queryable, rawTag: string, rawQuery: unknown, viewerProfileId: string | null): Promise<FeedResponse> {
    const tag = normalizeTag(parse(TagParam, { tag: rawTag }).tag);
    const f = parse(ProfilePostsQuery, rawQuery);
    return this.page(q, { tab: "for_you", tag, ...(f.cursor ? { cursor: decodeCursor(f.cursor) } : {}), limit: f.limit, viewerProfileId });
  }

  /** Feed de un evento (§5.3): sus reportes y publicaciones, por recientes. Un evento oculto no tiene feed. */
  async eventPosts(q: Queryable, eventId: string, rawQuery: unknown, viewerProfileId: string | null): Promise<FeedResponse> {
    const f = parse(ProfilePostsQuery, rawQuery);
    await this.events.getEvent(q, eventId);
    return this.page(q, { tab: "for_you", eventId, ...(f.cursor ? { cursor: decodeCursor(f.cursor) } : {}), limit: f.limit, viewerProfileId });
  }

  async tag(q: Queryable, rawTag: string, viewerProfileId: string | null): Promise<TagView> {
    return this.social.tag(q, normalizeTag(parse(TagParam, { tag: rawTag }).tag), viewerProfileId);
  }

  async searchTags(q: Queryable, rawQuery: unknown, viewerProfileId: string | null): Promise<TagView[]> {
    const f = parse(TagSearchQuery, rawQuery);
    return this.social.searchTags(q, normalizeTag(f.q.replace(/^#/, "")), viewerProfileId, f.limit);
  }

  async profile(q: Queryable, handle: string, viewerProfileId: string | null): Promise<ProfileView> {
    const { id: _id, ...view } = await this.social.profile(q, handle, viewerProfileId);
    return view;
  }

  async me(q: Queryable, profileId: string): Promise<MyProfile> {
    const view = await this.profile(q, await this.social.handleById(q, profileId), profileId);
    return { ...view, ...(await this.social.settings(q, profileId)) };
  }

  async updateMe(q: Queryable, profileId: string, body: unknown): Promise<MyProfile> {
    const patch = parse(UpdateProfileRequest, body);
    // País preferido (ADR 0085): solo códigos del dataset de fronteras, para no guardar países inexistentes.
    if (patch.country && !this.geo.isCountry(patch.country)) throw new DomainError("VALIDATION", `País desconocido: ${patch.country}`, 400);
    await this.social.updateProfile(q, profileId, patch);
    return this.me(q, profileId);
  }

  /**
   * Foto de perfil (ADR 0119). Solo una imagen propia, ya procesada (variante pública saneada: sin EXIF) y que no
   * esté adjunta a un post. Se guarda la URL de la miniatura. La foto anterior se purga (no la usa nadie más).
   * NO AI REQUIRED.
   */
  async setMyAvatar(q: Queryable, profileId: string, body: unknown): Promise<MyProfile> {
    const { mediaId } = parse(SetAvatarRequest, body);
    const image = mediaId ? await this.avatarImage(q, profileId, mediaId) : null;
    await this.purgeReplaced(q, await this.social.setAvatar(q, profileId, image));
    return this.me(q, profileId);
  }

  /** Logo de un negocio que administra quien llama (mismas reglas que la foto de perfil). NO AI REQUIRED. */
  async setBusinessLogo(q: Queryable, owner: { userId: string; profileId: string }, handle: string, body: unknown): Promise<BusinessView> {
    const { mediaId } = parse(SetAvatarRequest, body);
    const businessId = await this.business.ownedId(q, owner.userId, handle);
    const image = mediaId ? await this.avatarImage(q, owner.profileId, mediaId) : null;
    await this.purgeReplaced(q, await this.social.setBusinessLogo(q, businessId, image));
    return this.business.view(q, handle, owner);
  }

  private async avatarImage(q: Queryable, profileId: string, mediaId: string): Promise<{ mediaId: string; url: string }> {
    const [m] = await this.media.assertAttachable(q, profileId, [mediaId]);
    if (m!.kind !== "IMAGE") throw new DomainError("MEDIA_KIND_UNSUPPORTED", "La foto debe ser una imagen");
    if ((await this.social.postsWithMedia(q, mediaId)).length > 0) throw new DomainError("MEDIA_IN_USE", "Esa imagen ya está en una publicación", 409);
    const [view] = await this.media.publicViews(q, [mediaId], { requireApproval: false });
    if (!view) throw new DomainError("MEDIA_NOT_READY", "La imagen aún se está procesando", 409);
    return { mediaId, url: view.thumbUrl ?? view.url };
  }

  /** La foto sustituida se borra salvo que siga en uso (p. ej. la misma imagen como logo de un negocio propio). */
  private async purgeReplaced(q: Queryable, prev: string | null): Promise<void> {
    if (!prev || (await this.social.isAvatarMedia(q, prev)) || (await this.social.postsWithMedia(q, prev)).length > 0) return;
    await this.media.purgeMedia(q, [prev]);
  }

  async searchProfiles(q: Queryable, rawQuery: unknown, viewerProfileId: string | null): Promise<ProfileSearchResult[]> {
    const f = parse(ProfileSearchQuery, rawQuery);
    return this.social.searchProfiles(q, f.q, viewerProfileId, f.limit);
  }

  /** Seguir o dejar de seguir. Valida que el destino exista y sea público antes de guardarlo. */
  async setFollow(q: Queryable, followerProfileId: string, rawTarget: unknown, rawId: string, follow: boolean): Promise<{ following: boolean }> {
    const target = parse(FollowTarget, rawTarget);
    let targetId = rawId;
    if (!follow && target === "tag") targetId = normalizeTag(rawId);
    if (target === "business") targetId = follow ? await this.business.idByHandle(q, rawId) : await this.social.businessIdForModeration(q, rawId);
    else if (follow || target === "profile") {
      if (target === "profile") targetId = await this.social.profileIdByHandle(q, rawId);
      else if (target === "event") await this.events.getEvent(q, parse(FollowTargetId.event, rawId));
      else if (target === "tag") targetId = normalizeTag(parse(TagParam, { tag: rawId }).tag);
      else if ((await this.geo.areasByIds(q, [parse(FollowTargetId.place, rawId)])).length === 0) throw new DomainError("NOT_FOUND", "Lugar no encontrado", 404);
    }
    await this.social.setFollow(q, followerProfileId, FOLLOW_TYPE[target], targetId, follow);
    return { following: follow };
  }

  async myFollows(q: Queryable, profileId: string): Promise<MyFollows> {
    const rows = await this.social.follows(q, profileId);
    const places = await this.geo.areasByIds(q, rows.filter((r) => r.type === "PLACE").map((r) => r.targetId));
    return {
      profiles: rows.flatMap((r) => (r.type === "PROFILE" && r.handle ? [{ handle: r.handle, displayName: r.displayName ?? r.handle }] : [])),
      events: [...(await this.events.followedSummaries(q, rows.filter((r) => r.type === "EVENT" && UUID.test(r.targetId)).map((r) => r.targetId))).values()]
        .map((e) => ({ id: e.id, title: e.title, categoryCode: e.categoryCode, status: e.status })),
      places,
      tags: rows.flatMap((r) => (r.type === "TAG" ? [{ tag: r.targetId, display: r.displayName ?? r.targetId }] : [])),
      businesses: [...(await this.business.namesByIds(q, rows.filter((r) => r.type === "BUSINESS").map((r) => r.targetId))).values()],
    };
  }

  private async page(q: Queryable, filter: FeedFilter): Promise<FeedResponse> {
    const rows = await this.social.feed(q, filter);
    const posts = await this.compose(q, rows, filter.viewerProfileId);
    const last = rows[rows.length - 1];
    return { posts, nextCursor: rows.length === filter.limit && last ? encodeCursor(last.score, last.id) : null };
  }

  private async compose(q: Queryable, rows: FeedRow[], viewerProfileId: string | null = null, embed = true): Promise<FeedPost[]> {
    // Originales de lo compartido: se leen con las mismas reglas (bloqueos, moderación); si no llegan, "no disponible".
    const sharedIds = embed ? [...new Set(rows.flatMap((r) => (r.sharedPostId ? [r.sharedPostId] : [])))] : [];
    const originals = new Map<string, FeedPost>();
    if (sharedIds.length > 0) {
      const inner = await this.social.feed(q, { tab: "for_you", ids: sharedIds, limit: sharedIds.length, viewerProfileId });
      for (const p of await this.compose(q, inner, viewerProfileId, false)) originals.set(p.id, p);
    }
    const states = await this.events.publicStates(q, rows.flatMap((r) => (r.eventId ? [r.eventId] : [])));
    const sensitivityOf = (r: FeedRow): Sensitivity =>
      (r.eventId ? states.get(r.eventId)?.sensitivity : undefined) ?? (r.categoryCode ? this.ref.category(r.categoryCode, null)?.sensitivity : undefined) ?? "NORMAL";
    const strict = rows.filter((r) => sensitivityOf(r) !== "NORMAL").flatMap((r) => r.media.map((m) => m.id));
    const open = rows.filter((r) => sensitivityOf(r) === "NORMAL").flatMap((r) => r.media.map((m) => m.id));
    const views = new Map<string, MediaView>(
      [...(await this.media.publicViews(q, strict, { requireApproval: true })), ...(await this.media.publicViews(q, open, { requireApproval: false }))].map((v) => [v.id, v]),
    );
    return rows.map((r) => {
      const media = withWarning(r.media.flatMap((m) => (views.has(m.id) ? [views.get(m.id)!] : [])), sensitivityOf(r));
      const state = r.eventId ? states.get(r.eventId) : undefined;
      return {
        id: r.id,
        kind: r.kind,
        author: r.author,
        text: r.text,
        lang: r.lang,
        createdAt: r.createdAt.toISOString(),
        categoryCode: r.categoryCode,
        event: r.eventId && state ? { id: r.eventId, publicVerificationState: state.publicVerificationState } : null,
        place: state?.place ?? null,
        distanceBucket: r.distanceM === null ? null : bucket(r.distanceM),
        media,
        hiddenMediaCount: r.media.length - media.length,
        likeCount: r.likeCount,
        commentCount: r.commentCount,
        likedByMe: r.likedByMe,
        reactions: r.reactions,
        myReactions: r.myReactions,
        shareCount: r.shareCount,
        share: r.sharedPostId ? { post: originals.get(r.sharedPostId) ?? null } : null,
        mentions: r.mentions,
        businessMentions: r.businessMentions,
        mine: r.mine,
        editedAt: r.editedAt ? r.editedAt.toISOString() : null,
        // Solo quien lo escribió ve hasta cuándo puede editarlo (ADR 0136).
        editableUntil: editableUntil(r),
      };
    });
  }
}

const FollowTargetId = {
  event: z.uuid(),
  /** Id del índice geográfico: espacio de nombres + código ("PE:150122", "NE1:JPN-1860"). */
  place: z.string().max(40).regex(/^[A-Z0-9]+:[A-Za-z0-9-]+$/),
};

/** Tramos de distancia: suficientes para decidir, sin revelar posiciones exactas. */
export function bucket(m: number): string {
  if (m < 1000) return "<1km";
  if (m < 2000) return "<2km";
  if (m < 5000) return "<5km";
  if (m < 10_000) return "<10km";
  if (m < 25_000) return "<25km";
  return ">25km";
}

/** Cursor opaco: puntuación de orden + id del último post de la página. */
export const encodeCursor = (score: number, id: string) => Buffer.from(`${score}|${id}`).toString("base64url");

function decodeCursor(c: string): { score: number; id: string } {
  const [raw, id] = Buffer.from(c, "base64url").toString().split("|");
  const score = Number(raw);
  if (!id || !raw || !Number.isFinite(score) || !/^[0-9a-f-]{36}$/.test(id)) throw new DomainError("VALIDATION", "Cursor inválido");
  return { score, id };
}

function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const r = schema.safeParse(value);
  if (!r.success) throw new DomainError("VALIDATION", r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data;
}

function editableUntil(r: FeedRow): string | null {
  if (!r.mine || (r.kind !== "STANDARD" && r.kind !== "SHARE")) return null;
  const until = r.createdAt.getTime() + POST_EDIT_WINDOW_HOURS * 3_600_000;
  return until > Date.now() ? new Date(until).toISOString() : null;
}
