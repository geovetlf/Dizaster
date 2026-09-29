import { FeedQuery, type FeedPost, type FeedResponse, type MediaView, type Sensitivity } from "@dizaster/contracts";
import type { Queryable } from "../../platform/db.js";
import { DomainError } from "../../platform/errors.js";
import type { EventService } from "../event/index.js";
import type { MediaService } from "../media/index.js";
import type { ReferenceData } from "../reference/index.js";
import type { SocialService } from "../social/index.js";

/** Radio de "cerca de ti" (sobre ubicaciones públicas ya generalizadas). */
export const NEARBY_RADIUS_M = 25_000;

/**
 * Feed: compone posts (social), estado de verificación (event) y media saneada (media) sin que ningún módulo
 * lea el esquema de otro. La media de categorías sensibles solo aparece si moderación la aprobó.
 */
export class FeedService {
  constructor(
    private readonly social: SocialService,
    private readonly events: EventService,
    private readonly media: MediaService,
    private readonly ref: ReferenceData,
  ) {}

  async feed(q: Queryable, rawQuery: unknown, viewerProfileId: string | null): Promise<FeedResponse> {
    const parsed = FeedQuery.safeParse(rawQuery);
    if (!parsed.success) throw new DomainError("VALIDATION", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const f = parsed.data;
    const near = f.lat !== undefined && f.lng !== undefined ? { lat: f.lat, lng: f.lng } : undefined;
    const rows = await this.social.feed(q, {
      tab: f.tab,
      ...(f.category ? { category: f.category } : {}),
      ...(near ? { near } : {}),
      nearRadiusM: NEARBY_RADIUS_M,
      ...(f.cursor ? { cursor: decodeCursor(f.cursor) } : {}),
      limit: f.limit,
      viewerProfileId,
    });

    const states = await this.events.publicStates(q, rows.flatMap((r) => (r.eventId ? [r.eventId] : [])));
    const sensitivityOf = (r: (typeof rows)[number]): Sensitivity =>
      (r.eventId ? states.get(r.eventId)?.sensitivity : undefined) ?? (r.categoryCode ? this.ref.category(r.categoryCode, null)?.sensitivity : undefined) ?? "NORMAL";
    const strict = rows.filter((r) => sensitivityOf(r) !== "NORMAL").flatMap((r) => r.media.map((m) => m.id));
    const open = rows.filter((r) => sensitivityOf(r) === "NORMAL").flatMap((r) => r.media.map((m) => m.id));
    const views = new Map<string, MediaView>(
      [...(await this.media.publicViews(q, strict, { requireApproval: true })), ...(await this.media.publicViews(q, open, { requireApproval: false }))].map((v) => [v.id, v]),
    );

    const posts: FeedPost[] = rows.map((r) => {
      const media = r.media.flatMap((m) => (views.has(m.id) ? [views.get(m.id)!] : []));
      const state = r.eventId ? states.get(r.eventId) : undefined;
      return {
        id: r.id,
        kind: r.kind,
        author: r.author,
        text: r.text,
        createdAt: r.createdAt.toISOString(),
        categoryCode: r.categoryCode,
        event: r.eventId && state ? { id: r.eventId, publicVerificationState: state.publicVerificationState } : null,
        distanceBucket: r.distanceM === null ? null : bucket(r.distanceM),
        media,
        hiddenMediaCount: r.media.length - media.length,
        likeCount: r.likeCount,
        commentCount: r.commentCount,
        likedByMe: r.likedByMe,
      };
    });
    const last = rows[rows.length - 1];
    return { posts, nextCursor: rows.length === f.limit && last ? encodeCursor(last.createdAt, last.id) : null };
  }
}

/** Tramos de distancia: suficientes para decidir, sin revelar posiciones exactas. */
export function bucket(m: number): string {
  if (m < 1000) return "<1km";
  if (m < 2000) return "<2km";
  if (m < 5000) return "<5km";
  if (m < 10_000) return "<10km";
  if (m < 25_000) return "<25km";
  return ">25km";
}

const encodeCursor = (d: Date, id: string) => Buffer.from(`${d.toISOString()}|${id}`).toString("base64url");

function decodeCursor(c: string): { createdAt: Date; id: string } {
  const [iso, id] = Buffer.from(c, "base64url").toString().split("|");
  const createdAt = new Date(iso ?? "");
  if (!id || Number.isNaN(createdAt.getTime()) || !/^[0-9a-f-]{36}$/.test(id)) throw new DomainError("VALIDATION", "Cursor inválido");
  return { createdAt, id };
}
