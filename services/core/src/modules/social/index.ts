import type { CommentView, FeedTab, GeoPoint, PostAuthor } from "@dizaster/contracts";
import type { Queryable } from "../../platform/db.js";
import { DomainError, notFound } from "../../platform/errors.js";
import { newId } from "../../platform/ids.js";

/**
 * Social Engine: perfiles, posts, reacciones, comentarios y feed. Un REPORT siempre tiene un POST como cara
 * social (kind = REPORT) para que comentarios, reacciones y compartir funcionen igual en todo el contenido.
 * Seguir perfiles y ranking personalizado llegan después; el feed "para ti" es hoy por recientes.
 */
export interface CreatePostInput {
  authorProfileId: string;
  kind: "STANDARD" | "REPORT" | "SHARE" | "OFFICIAL_UPDATE";
  text: string | null;
  authorVisibility: "PUBLIC" | "PSEUDONYMOUS";
  /** Tema del post (categoría del reporte, si lo es). */
  categoryCode?: string | null;
  /** Debe llegar YA generalizada; social nunca recibe la ubicación precisa. */
  publicPoint: GeoPoint | null;
}

export interface FeedRow {
  id: string;
  kind: "STANDARD" | "REPORT" | "SHARE" | "OFFICIAL_UPDATE";
  author: PostAuthor;
  text: string | null;
  createdAt: Date;
  categoryCode: string | null;
  eventId: string | null;
  distanceM: number | null;
  media: { id: string; kind: "IMAGE" | "VIDEO_RECORDED" }[];
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
}

export interface FeedFilter {
  tab: FeedTab;
  /** Prefijo de categoría: "fire" incluye "fire.structure". */
  category?: string;
  near?: GeoPoint;
  nearRadiusM?: number;
  cursor?: { createdAt: Date; id: string };
  limit: number;
  viewerProfileId: string | null;
}

export class SocialService {
  async createProfile(tx: Queryable, input: { userId: string; handleHint: string }): Promise<{ id: string; handle: string }> {
    const id = newId();
    const base = input.handleHint.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20) || "usuario";
    const handle = `${base}_${id.slice(-6)}`;
    await tx.query(`INSERT INTO social.profiles (id, user_id, handle, display_name) VALUES ($1, $2, $3, $4)`, [
      id, input.userId, handle, input.handleHint.slice(0, 60),
    ]);
    return { id, handle };
  }

  async profileForUser(q: Queryable, userId: string): Promise<{ id: string; handle: string }> {
    const { rows } = await q.query<{ id: string; handle: string }>(`SELECT id, handle FROM social.profiles WHERE user_id = $1`, [userId]);
    if (!rows[0]) throw notFound("Perfil");
    return rows[0];
  }

  async createPost(tx: Queryable, input: CreatePostInput): Promise<string> {
    const id = newId();
    await tx.query(
      `INSERT INTO social.posts (id, author_type, author_id, kind, author_visibility, text, category_code, public_point)
       VALUES ($1, 'PROFILE', $2, $3, $4, $5, $8,
               CASE WHEN $6::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography END)`,
      [id, input.authorProfileId, input.kind, input.authorVisibility, input.text, input.publicPoint?.lng ?? null, input.publicPoint?.lat ?? null,
        input.categoryCode ?? null],
    );
    return id;
  }

  /** Adjunta media (ya validada por el Media Engine) a un post. Una media solo puede pertenecer a un post. */
  async attachMedia(tx: Queryable, postId: string, media: { id: string; kind: "IMAGE" | "VIDEO_RECORDED" }[]): Promise<void> {
    if (media.length === 0) return;
    const mediaIds = media.map((m) => m.id);
    const taken = await tx.query(`SELECT 1 FROM social.post_media WHERE media_id = ANY($1) LIMIT 1`, [mediaIds]);
    if (taken.rowCount) throw new DomainError("MEDIA_ALREADY_ATTACHED", "La media ya está adjunta a otra publicación", 409);
    await tx.query(
      `INSERT INTO social.post_media (post_id, media_id, kind, position)
       SELECT $1, m, k, i - 1 FROM unnest($2::uuid[], $3::text[]) WITH ORDINALITY AS t(m, k, i)`,
      [postId, mediaIds, media.map((m) => m.kind)],
    );
  }

  async linkPostToEvent(tx: Queryable, postId: string, eventId: string, linkType: "REPORT" | "MENTION" | "UPDATE"): Promise<void> {
    await tx.query(
      `INSERT INTO social.post_event_links (post_id, event_id, link_type) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [postId, eventId, linkType],
    );
  }

  /** Vista pública de un post: si es seudónimo, no revela el autor. */
  async getPost(q: Queryable, postId: string) {
    const { rows } = await q.query<{
      id: string; kind: string; text: string | null; author_visibility: string; handle: string; created_at: Date;
      lat: number | null; lng: number | null;
    }>(
      `SELECT p.id, p.kind, p.text, p.author_visibility, pr.handle, p.created_at,
              ST_Y(p.public_point::geometry) AS lat, ST_X(p.public_point::geometry) AS lng
         FROM social.posts p JOIN social.profiles pr ON pr.id = p.author_id
        WHERE p.id = $1 AND p.deleted_at IS NULL AND p.moderation_state IN ('VISIBLE','LIMITED')`,
      [postId],
    );
    const r = rows[0];
    if (!r) throw notFound("Post");
    return {
      id: r.id,
      kind: r.kind,
      text: r.text,
      author: r.author_visibility === "PSEUDONYMOUS" ? { pseudonymous: true as const } : { pseudonymous: false as const, handle: r.handle },
      publicPoint: r.lat === null || r.lng === null ? null : { lat: r.lat, lng: r.lng },
      createdAt: r.created_at.toISOString(),
    };
  }

  /**
   * Feed público. Orden por recientes con cursor estable (fecha, id). Solo posts públicos y visibles.
   * "nearby" usa la ubicación pública ya generalizada del post; "following" espera a la función de seguir.
   */
  async feed(q: Queryable, f: FeedFilter): Promise<FeedRow[]> {
    if (f.tab === "following") return [];
    if (f.tab === "nearby" && !f.near) return [];
    const params: unknown[] = [f.limit, f.viewerProfileId];
    const where = [`p.deleted_at IS NULL`, `p.visibility = 'PUBLIC'`, `p.moderation_state = 'VISIBLE'`];
    const nearSql = f.near ? `ST_SetSRID(ST_MakePoint($${params.push(f.near.lng)}, $${params.push(f.near.lat)}), 4326)::geography` : null;
    if (f.category) {
      where.push(`(p.category_code = $${params.push(f.category)} OR p.category_code LIKE $${params.push(`${f.category}.%`)})`);
    }
    if (f.tab === "nearby" && nearSql) where.push(`ST_DWithin(p.public_point, ${nearSql}, $${params.push(f.nearRadiusM ?? 25_000)})`);
    if (f.tab === "videos") where.push(`EXISTS (SELECT 1 FROM social.post_media v WHERE v.post_id = p.id AND v.kind = 'VIDEO_RECORDED')`);
    if (f.cursor) where.push(`(p.created_at, p.id) < ($${params.push(f.cursor.createdAt)}::timestamptz, $${params.push(f.cursor.id)}::uuid)`);

    const { rows } = await q.query<{
      id: string; kind: FeedRow["kind"]; author_visibility: string; handle: string; display_name: string; text: string | null;
      created_at: Date; category_code: string | null; event_id: string | null; distance_m: number | null;
      media: { id: string; kind: "IMAGE" | "VIDEO_RECORDED" }[] | null; like_count: number; comment_count: number; liked: boolean;
    }>(
      `SELECT p.id, p.kind, p.author_visibility, pr.handle, pr.display_name, p.text, p.created_at, p.category_code,
              (SELECT l.event_id FROM social.post_event_links l WHERE l.post_id = p.id ORDER BY l.created_at LIMIT 1) AS event_id,
              ${nearSql ? `ST_Distance(p.public_point, ${nearSql})` : "NULL"}::float8 AS distance_m,
              (SELECT json_agg(json_build_object('id', m.media_id, 'kind', m.kind) ORDER BY m.position)
                 FROM social.post_media m WHERE m.post_id = p.id) AS media,
              (SELECT count(*) FROM social.reactions r WHERE r.post_id = p.id)::int AS like_count,
              (SELECT count(*) FROM social.comments c WHERE c.post_id = p.id AND c.deleted_at IS NULL AND c.moderation_state = 'VISIBLE')::int AS comment_count,
              EXISTS (SELECT 1 FROM social.reactions r WHERE r.post_id = p.id AND r.profile_id = $2) AS liked
         FROM social.posts p JOIN social.profiles pr ON pr.id = p.author_id
        WHERE ${where.join(" AND ")}
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT $1`,
      params,
    );
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      author: r.author_visibility === "PSEUDONYMOUS" ? { pseudonymous: true } : { pseudonymous: false, handle: r.handle, displayName: r.display_name },
      text: r.text,
      createdAt: r.created_at,
      categoryCode: r.category_code,
      eventId: r.event_id,
      distanceM: r.distance_m,
      media: r.media ?? [],
      likeCount: r.like_count,
      commentCount: r.comment_count,
      likedByMe: r.liked,
    }));
  }

  /** Me gusta: idempotente en ambos sentidos. Devuelve el total actualizado. */
  async setLike(q: Queryable, postId: string, profileId: string, liked: boolean): Promise<{ likeCount: number; likedByMe: boolean }> {
    await this.assertVisible(q, postId);
    if (liked) {
      await q.query(`INSERT INTO social.reactions (post_id, profile_id, kind) VALUES ($1, $2, 'LIKE') ON CONFLICT DO NOTHING`, [postId, profileId]);
    } else {
      await q.query(`DELETE FROM social.reactions WHERE post_id = $1 AND profile_id = $2 AND kind = 'LIKE'`, [postId, profileId]);
    }
    const { rows } = await q.query<{ n: number }>(`SELECT count(*)::int AS n FROM social.reactions WHERE post_id = $1`, [postId]);
    return { likeCount: rows[0]!.n, likedByMe: liked };
  }

  async addComment(q: Queryable, postId: string, profileId: string, text: string): Promise<CommentView> {
    await this.assertVisible(q, postId);
    const recent = await q.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM social.comments WHERE author_profile_id = $1 AND created_at > now() - interval '1 minute'`,
      [profileId],
    );
    if (recent.rows[0]!.n >= 10) throw new DomainError("RATE_LIMITED", "Demasiados comentarios seguidos", 429);
    const id = newId();
    await q.query(`INSERT INTO social.comments (id, post_id, author_profile_id, text) VALUES ($1, $2, $3, $4)`, [id, postId, profileId, text]);
    return (await this.comments(q, postId)).find((c) => c.id === id)!;
  }

  async comments(q: Queryable, postId: string): Promise<CommentView[]> {
    const { rows } = await q.query<{ id: string; handle: string; display_name: string; text: string; created_at: Date }>(
      `SELECT c.id, pr.handle, pr.display_name, c.text, c.created_at
         FROM social.comments c JOIN social.profiles pr ON pr.id = c.author_profile_id
        WHERE c.post_id = $1 AND c.deleted_at IS NULL AND c.moderation_state = 'VISIBLE'
        ORDER BY c.created_at, c.id LIMIT 200`,
      [postId],
    );
    return rows.map((r) => ({ id: r.id, author: { handle: r.handle, displayName: r.display_name }, text: r.text, createdAt: r.created_at.toISOString() }));
  }

  private async assertVisible(q: Queryable, postId: string): Promise<void> {
    const { rowCount } = await q.query(
      `SELECT 1 FROM social.posts WHERE id = $1 AND deleted_at IS NULL AND moderation_state IN ('VISIBLE','LIMITED')`,
      [postId],
    );
    if (!rowCount) throw notFound("Post");
  }
}
