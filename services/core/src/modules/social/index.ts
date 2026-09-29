import type { CommentView, FeedTab, GeoPoint, PostAuthor, ProfileSearchResult, ProfileView } from "@dizaster/contracts";
import type { Queryable } from "../../platform/db.js";
import { DomainError, notFound } from "../../platform/errors.js";
import { newId } from "../../platform/ids.js";

/**
 * Social Engine: perfiles, posts, reacciones, comentarios y feed. Un REPORT siempre tiene un POST como cara
 * social (kind = REPORT) para que comentarios, reacciones y compartir funcionen igual en todo el contenido.
 * Seguir (perfiles, eventos, lugares) y orden determinista del feed viven aquí; los datos de eventos que el orden
 * necesita llegan como proyección (social.event_signals) desde el outbox, nunca leyendo el esquema event.
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
  /** Clave de orden (para el cursor). */
  score: number;
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
  cursor?: { score: number; id: string };
  limit: number;
  viewerProfileId: string | null;
  /** Posts públicos de un perfil (su página). */
  authorProfileId?: string;
}

export type FollowType = "PROFILE" | "EVENT" | "PLACE";
const MAX_FOLLOWS = 2000;
/** "Para ti" ordena lo reciente: fuera de esta ventana, el contenido se encuentra por lugar, evento o perfil. */
export const FOR_YOU_WINDOW_DAYS = 30;

/**
 * Ventaja en horas de cada señal (Blueprint §8.4, sin ML). Suma acotada: nada antiguo tapa lo nuevo para siempre.
 * Un FALSE baja 24 h; un evento oficial y grave cerca de ti sube hasta 18 h + 4 h si sigues al autor.
 */
export const RANK_BOOST_HOURS = {
  state: { OFFICIALLY_CONFIRMED: 6, EXTERNALLY_CORROBORATED: 4, COMMUNITY_CORROBORATED: 2, UNVERIFIED: 0, DISPUTED: -6, FALSE: -24 },
  perSeverityStep: 1.5,
  distance: [[1000, 6], [5000, 4], [25_000, 2]] as const,
  followedAuthor: 4,
};

function rankSql(nearSql: string | null): string {
  const B = RANK_BOOST_HOURS;
  const state = Object.entries(B.state).map(([k, v]) => `WHEN '${k}' THEN ${v}`).join(" ");
  const distance = nearSql
    ? `CASE WHEN p.public_point IS NULL THEN 0 ${B.distance.map(([m, h]) => `WHEN ST_DWithin(p.public_point, ${nearSql}, ${m}) THEN ${h}`).join(" ")} ELSE 0 END`
    : "0";
  return `extract(epoch FROM p.created_at) / 3600.0
    + CASE coalesce(s.public_state, 'UNVERIFIED') ${state} ELSE 0 END
    + (coalesce(s.severity, 1) - 1) * ${B.perSeverityStep}
    + ${distance}
    + CASE WHEN p.author_visibility = 'PUBLIC' AND EXISTS (
        SELECT 1 FROM social.follows fa WHERE fa.follower_profile_id = $2 AND fa.target_type = 'PROFILE' AND fa.target_id = p.author_id::text)
      THEN ${B.followedAuthor} ELSE 0 END`;
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
   * Feed público con cursor estable (puntuación, id). Solo posts públicos y visibles.
   * - for_you: orden determinista (Blueprint §8.4) = recencia desplazada por verificación, severidad, cercanía y
   *   autores seguidos. Cada señal equivale a "horas de ventaja", así el orden es estable entre páginas.
   * - nearby / videos / following / perfil: por recientes.
   * Seguir a alguien nunca muestra sus posts seudónimos.
   */
  async feed(q: Queryable, f: FeedFilter): Promise<FeedRow[]> {
    if (f.tab === "following" && !f.viewerProfileId) return [];
    if (f.tab === "nearby" && !f.near) return [];
    const params: unknown[] = [f.limit, f.viewerProfileId];
    const where = [`p.deleted_at IS NULL`, `p.visibility = 'PUBLIC'`, `p.moderation_state = 'VISIBLE'`];
    const nearSql = f.near ? `ST_SetSRID(ST_MakePoint($${params.push(f.near.lng)}, $${params.push(f.near.lat)}), 4326)::geography` : null;
    if (f.category) {
      where.push(`(p.category_code = $${params.push(f.category)} OR p.category_code LIKE $${params.push(`${f.category}.%`)})`);
    }
    if (f.authorProfileId) where.push(`p.author_id = $${params.push(f.authorProfileId)}::uuid AND p.author_visibility = 'PUBLIC'`);
    if (f.tab === "nearby" && nearSql) where.push(`ST_DWithin(p.public_point, ${nearSql}, $${params.push(f.nearRadiusM ?? 25_000)})`);
    if (f.tab === "videos") where.push(`EXISTS (SELECT 1 FROM social.post_media v WHERE v.post_id = p.id AND v.kind = 'VIDEO_RECORDED')`);
    if (f.tab === "following") {
      const followed = (type: string) => `(SELECT target_id FROM social.follows WHERE follower_profile_id = $2 AND target_type = '${type}')`;
      where.push(`((p.author_visibility = 'PUBLIC' AND p.author_id::text IN ${followed("PROFILE")})
                   OR le.event_id::text IN ${followed("EVENT")}
                   OR s.region_id IN ${followed("PLACE")} OR s.district_id IN ${followed("PLACE")})`);
    }
    const ranked = f.tab === "for_you" && !f.authorProfileId;
    if (ranked) where.push(`p.created_at > now() - make_interval(days => ${FOR_YOU_WINDOW_DAYS})`);
    const score = ranked ? rankSql(nearSql) : `extract(epoch FROM p.created_at) / 3600.0`;
    const cursor = f.cursor ? `WHERE (x.score, x.id) < ($${params.push(f.cursor.score)}::float8, $${params.push(f.cursor.id)}::uuid)` : "";

    const { rows } = await q.query<{
      id: string; kind: FeedRow["kind"]; author_visibility: string; handle: string; display_name: string; text: string | null;
      created_at: Date; category_code: string | null; event_id: string | null; distance_m: number | null; score: number;
      media: { id: string; kind: "IMAGE" | "VIDEO_RECORDED" }[] | null; like_count: number; comment_count: number; liked: boolean;
    }>(
      `WITH x AS (
         SELECT p.id, p.kind, p.author_visibility, pr.handle, pr.display_name, p.text, p.created_at, p.category_code, le.event_id,
                ${nearSql ? `ST_Distance(p.public_point, ${nearSql})` : "NULL"}::float8 AS distance_m,
                (${score})::float8 AS score
           FROM social.posts p
           JOIN social.profiles pr ON pr.id = p.author_id
           LEFT JOIN LATERAL (SELECT l.event_id FROM social.post_event_links l WHERE l.post_id = p.id ORDER BY l.created_at LIMIT 1) le ON true
           LEFT JOIN social.event_signals s ON s.event_id = le.event_id
          WHERE ${where.join(" AND ")}
       )
       SELECT x.*,
              (SELECT json_agg(json_build_object('id', m.media_id, 'kind', m.kind) ORDER BY m.position)
                 FROM social.post_media m WHERE m.post_id = x.id) AS media,
              (SELECT count(*) FROM social.reactions r WHERE r.post_id = x.id)::int AS like_count,
              (SELECT count(*) FROM social.comments c WHERE c.post_id = x.id AND c.deleted_at IS NULL AND c.moderation_state = 'VISIBLE')::int AS comment_count,
              EXISTS (SELECT 1 FROM social.reactions r WHERE r.post_id = x.id AND r.profile_id = $2) AS liked
         FROM x ${cursor}
        ORDER BY x.score DESC, x.id DESC
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
      score: r.score,
      media: r.media ?? [],
      likeCount: r.like_count,
      commentCount: r.comment_count,
      likedByMe: r.liked,
    }));
  }

  // ───────────── Seguir ─────────────

  /** Idempotente. El destino ya fue validado por quien llama (existe y es público). */
  async setFollow(q: Queryable, followerProfileId: string, type: FollowType, targetId: string, follow: boolean): Promise<void> {
    if (!follow) {
      await q.query(`DELETE FROM social.follows WHERE follower_profile_id = $1 AND target_type = $2 AND target_id = $3`, [followerProfileId, type, targetId]);
      return;
    }
    if (type === "PROFILE" && targetId === followerProfileId) throw new DomainError("VALIDATION", "No puedes seguirte a ti mismo");
    const { rows } = await q.query<{ n: number }>(`SELECT count(*)::int AS n FROM social.follows WHERE follower_profile_id = $1`, [followerProfileId]);
    if (rows[0]!.n >= MAX_FOLLOWS) throw new DomainError("LIMIT_REACHED", `Puedes seguir hasta ${MAX_FOLLOWS} perfiles, eventos o lugares`, 409);
    await q.query(
      `INSERT INTO social.follows (follower_profile_id, target_type, target_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [followerProfileId, type, targetId],
    );
  }

  async follows(q: Queryable, profileId: string): Promise<{ type: FollowType; targetId: string; handle: string | null; displayName: string | null }[]> {
    const { rows } = await q.query<{ target_type: FollowType; target_id: string; handle: string | null; display_name: string | null }>(
      `SELECT f.target_type, f.target_id, pr.handle, pr.display_name
         FROM social.follows f
         LEFT JOIN social.profiles pr ON f.target_type = 'PROFILE' AND pr.id::text = f.target_id
        WHERE f.follower_profile_id = $1
        ORDER BY f.created_at DESC`,
      [profileId],
    );
    return rows.map((r) => ({ type: r.target_type, targetId: r.target_id, handle: r.handle, displayName: r.display_name }));
  }

  /** Seguidores de un EVENT o de alguno de sus lugares, con la cuenta de cada perfil (para el Alert Engine). */
  async followersOf(q: Queryable, t: { eventId: string; placeIds: string[] }): Promise<{ profileId: string; userId: string; via: "EVENT" | "PLACE" }[]> {
    const { rows } = await q.query<{ profile_id: string; user_id: string; via: "EVENT" | "PLACE" }>(
      `SELECT DISTINCT ON (f.follower_profile_id) f.follower_profile_id AS profile_id, pr.user_id, f.target_type AS via
         FROM social.follows f JOIN social.profiles pr ON pr.id = f.follower_profile_id
        WHERE (f.target_type = 'EVENT' AND f.target_id = $1) OR (f.target_type = 'PLACE' AND f.target_id = ANY($2))
        ORDER BY f.follower_profile_id, (f.target_type = 'EVENT') DESC`,
      [t.eventId, t.placeIds],
    );
    return rows.map((r) => ({ profileId: r.profile_id, userId: r.user_id, via: r.via }));
  }

  async userIdsForProfiles(q: Queryable, profileIds: string[]): Promise<Map<string, string>> {
    if (profileIds.length === 0) return new Map();
    const { rows } = await q.query<{ id: string; user_id: string }>(`SELECT id, user_id FROM social.profiles WHERE id = ANY($1)`, [profileIds]);
    return new Map(rows.map((r) => [r.id, r.user_id]));
  }

  async handleById(q: Queryable, profileId: string): Promise<string> {
    const { rows } = await q.query<{ handle: string }>(`SELECT handle FROM social.profiles WHERE id = $1`, [profileId]);
    if (!rows[0]) throw notFound("Perfil");
    return rows[0].handle;
  }

  async profileIdByHandle(q: Queryable, handle: string): Promise<string> {
    const { rows } = await q.query<{ id: string }>(`SELECT id FROM social.profiles WHERE lower(handle) = lower($1)`, [handle]);
    if (!rows[0]) throw notFound("Perfil");
    return rows[0].id;
  }

  /** Perfil público: los contadores solo incluyen posts con autoría pública. */
  async profile(q: Queryable, handle: string, viewerProfileId: string | null): Promise<ProfileView & { id: string }> {
    const { rows } = await q.query<{
      id: string; handle: string; display_name: string; created_at: Date; followers: number; following: number; posts: number; followed: boolean;
    }>(
      `SELECT pr.id, pr.handle, pr.display_name, pr.created_at,
              (SELECT count(*) FROM social.follows f WHERE f.target_type = 'PROFILE' AND f.target_id = pr.id::text)::int AS followers,
              (SELECT count(*) FROM social.follows f WHERE f.follower_profile_id = pr.id AND f.target_type = 'PROFILE')::int AS following,
              (SELECT count(*) FROM social.posts p WHERE p.author_id = pr.id AND p.author_visibility = 'PUBLIC' AND p.visibility = 'PUBLIC'
                  AND p.deleted_at IS NULL AND p.moderation_state = 'VISIBLE')::int AS posts,
              EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_profile_id = $2 AND f.target_type = 'PROFILE' AND f.target_id = pr.id::text) AS followed
         FROM social.profiles pr WHERE lower(pr.handle) = lower($1)`,
      [handle, viewerProfileId],
    );
    const r = rows[0];
    if (!r) throw notFound("Perfil");
    return {
      id: r.id, handle: r.handle, displayName: r.display_name, createdAt: r.created_at.toISOString(),
      followerCount: r.followers, followingCount: r.following, postCount: r.posts, followedByMe: r.followed, isMe: r.id === viewerProfileId,
    };
  }

  /** Busca personas por handle o nombre (prefijo de palabra). Primero coincidencias exactas y cuentas más seguidas. */
  async searchProfiles(q: Queryable, text: string, viewerProfileId: string | null, limit: number): Promise<ProfileSearchResult[]> {
    const key = text.toLowerCase().replace(/^@/, "").replace(/[\\%_]/g, "\\$&");
    const { rows } = await q.query<{ handle: string; display_name: string; followers: number; followed: boolean }>(
      `SELECT pr.handle, pr.display_name,
              (SELECT count(*) FROM social.follows f WHERE f.target_type = 'PROFILE' AND f.target_id = pr.id::text)::int AS followers,
              EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_profile_id = $2 AND f.target_type = 'PROFILE' AND f.target_id = pr.id::text) AS followed
         FROM social.profiles pr
        WHERE lower(pr.handle) LIKE $1 || '%' OR lower(pr.display_name) LIKE $1 || '%' OR lower(pr.display_name) LIKE '% ' || $1 || '%'
        ORDER BY (lower(pr.handle) = $1) DESC, followers DESC, pr.handle
        LIMIT $3`,
      [key, viewerProfileId, limit],
    );
    return rows.map((r) => ({ handle: r.handle, displayName: r.display_name, followerCount: r.followers, followedByMe: r.followed }));
  }

  // ───────────── Señales de eventos para ordenar (proyección alimentada por el outbox) ─────────────

  async upsertEventSignal(
    q: Queryable,
    e: { eventId: string; severity?: number; publicState?: string; regionId?: string | null; districtId?: string | null },
  ): Promise<void> {
    await q.query(
      `INSERT INTO social.event_signals (event_id, severity, public_state, region_id, district_id)
       VALUES ($1, coalesce($2, 1), coalesce($3, 'UNVERIFIED'), $4, $5)
       ON CONFLICT (event_id) DO UPDATE SET
         severity = coalesce($2, social.event_signals.severity),
         public_state = coalesce($3, social.event_signals.public_state),
         region_id = CASE WHEN $6 THEN $4 ELSE social.event_signals.region_id END,
         district_id = CASE WHEN $6 THEN $5 ELSE social.event_signals.district_id END,
         updated_at = now()`,
      [e.eventId, e.severity ?? null, e.publicState ?? null, e.regionId ?? null, e.districtId ?? null, e.regionId !== undefined],
    );
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
