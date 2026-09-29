import { createHash } from "node:crypto";
import { detectLanguage, detectPersonalData, extractMentions, extractTags, textFingerprintBase, type CommentView, type FeedTab, type GeoPoint, type PostAuthor, type ProfileSearchResult, type ReactionCounts, type ReactionKind, type ReactionState, type CommentReactionKind, type Units, type UpdateProfileRequest, type ProfileView, type TagView } from "@dizaster/contracts";
import type { Queryable } from "../../platform/db.js";
import { publish, type OutboxDispatcher } from "../../platform/outbox.js";
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
  /** Solo SHARE: el post original. */
  sharedPostId?: string | null;
  /** Publica un negocio (ya comprobado que la persona lo administra). Nunca seudónimo. */
  businessId?: string | null;
  /** Retraso de publicación (ADR 0099): antes de esta hora solo lo ve su autor. */
  visibleAfterMinutes?: number;
}

export interface FeedRow {
  id: string;
  kind: "STANDARD" | "REPORT" | "SHARE" | "OFFICIAL_UPDATE";
  author: PostAuthor;
  text: string | null;
  /** Idioma detectado del texto (ADR 0091), o null si no hay un ganador claro. */
  lang: string | null;
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
  reactions: ReactionCounts;
  myReactions: ReactionKind[];
  sharedPostId: string | null;
  shareCount: number;
  mentions: string[];
  businessMentions: string[];
  mine: boolean;
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
  /** Etiqueta en forma canónica. */
  tag?: string;
  /** Posts de un negocio (su página). */
  authorBusinessId?: string;
  /** Posts ligados a un evento (reportes y publicaciones sobre él). */
  eventId?: string;
  /** Posts concretos (los originales de lo compartido), sin ventana de tiempo. */
  ids?: string[];
}

export type FollowType = "PROFILE" | "EVENT" | "PLACE" | "TAG" | "BUSINESS";
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
  /** Autor con reputación baja (ADR 0031): sigue visible, pero medio día detrás en "Para ti". */
  lowTrustAuthor: -12,
};

/** Mismo texto de al menos tantas cuentas distintas dentro de la ventana → a revisión humana como posible spam. */
export const DUPLICATE_TEXT = { minAuthors: 3, windowHours: 24, maxPosts: 50 } as const;

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
        SELECT 1 FROM social.follows fa WHERE fa.follower_profile_id = $2 AND fa.target_type = p.author_type AND fa.target_id = p.author_id::text)
      THEN ${B.followedAuthor} ELSE 0 END
    + CASE WHEN p.author_type = 'PROFILE' AND pr.low_trust THEN ${B.lowTrustAuthor} ELSE 0 END`;
}

export class SocialService {
  /** Números públicos conocidos (dataset de emergencias), en dígitos: no cuentan como teléfono personal (ADR 0088). */
  constructor(private readonly publicNumbers: ReadonlySet<string> = new Set()) {}

  registerHandlers(dispatcher: OutboxDispatcher): void {
    dispatcher.on("AccountDeleted", "social.anonymize-account", async (e, tx) => {
      await this.anonymizeProfile(tx, e.payload.profileId);
      await this.deleteBusinessesOf(tx, e.payload.userId);
    });
    // Fusión de eventos (ADR 0034): los posts del duplicado pasan al destino y vuelven si se revierte.
    dispatcher.on("EventMerged", "social.redirect-event-links", async (e, tx) => {
      await tx.query(
        `UPDATE social.post_event_links l SET event_id = $1, via_merge = $2
          WHERE l.event_id = $2 AND NOT EXISTS (SELECT 1 FROM social.post_event_links x WHERE x.post_id = l.post_id AND x.event_id = $1)`,
        [e.payload.targetEventId, e.payload.mergedEventId],
      );
      // Quien seguía el duplicado sigue ahora el destino (ADR 0093). NO AI REQUIRED.
      await tx.query(
        `INSERT INTO social.follows (follower_profile_id, target_type, target_id, via_merge)
         SELECT follower_profile_id, 'EVENT', $1, $2::text::uuid FROM social.follows WHERE target_type = 'EVENT' AND target_id = $2::text
         ON CONFLICT DO NOTHING`,
        [e.payload.targetEventId, e.payload.mergedEventId],
      );
    });
    dispatcher.on("EventMergeReverted", "social.restore-event-links", async (e, tx) => {
      await tx.query(
        `UPDATE social.post_event_links SET event_id = $2, via_merge = NULL WHERE event_id = $1 AND via_merge = $2`,
        [e.payload.targetEventId, e.payload.restoredEventId],
      );
      // El seguimiento original del duplicado nunca se borró: basta quitar el copiado.
      await tx.query(
        `DELETE FROM social.follows WHERE target_type = 'EVENT' AND target_id = $1::text AND via_merge = $2::text::uuid`,
        [e.payload.targetEventId, e.payload.restoredEventId],
      );
    });
    dispatcher.on("AuthorStandingChanged", "social.author-standing", async (e, tx) => {
      await tx.query(`UPDATE social.profiles SET low_trust = $2 WHERE user_id = $1`, [e.payload.userId, e.payload.lowTrust]);
    });
  }

  /**
   * Borrado de cuenta (ADR 0021): el perfil deja de existir públicamente (handle neutro, sin nombre), su
   * contenido se retira y se vacía, y se cortan sus relaciones. Los registros de moderación se conservan aparte.
   */
  async anonymizeProfile(q: Queryable, profileId: string): Promise<void> {
    await q.query(
      `UPDATE social.profiles SET handle = 'borrado_' || replace(id::text, '-', ''), display_name = '', bio = NULL, home_country = NULL,
              deleted_at = COALESCE(deleted_at, now()), updated_at = now()
        WHERE id = $1`,
      [profileId],
    );
    await q.query(
      `UPDATE social.posts SET text = NULL, public_point = NULL, deleted_at = COALESCE(deleted_at, now()), updated_at = now()
        WHERE author_type = 'PROFILE' AND author_id = $1`,
      [profileId],
    );
    await q.query(`UPDATE social.comments SET text = '-', deleted_at = COALESCE(deleted_at, now()) WHERE author_profile_id = $1`, [profileId]);
    await q.query(`DELETE FROM social.reactions WHERE profile_id = $1`, [profileId]);
    await q.query(`DELETE FROM social.comment_reactions WHERE profile_id = $1`, [profileId]);
    await q.query(`DELETE FROM social.post_mentions WHERE profile_id = $1`, [profileId]);
    await q.query(`DELETE FROM social.follows WHERE follower_profile_id = $1 OR (target_type = 'PROFILE' AND target_id = $1::text)`, [profileId]);
    await q.query(`DELETE FROM social.blocks WHERE blocker_profile_id = $1 OR blocked_profile_id = $1`, [profileId]);
    await q.query(`DELETE FROM social.business_blocks WHERE blocker_profile_id = $1`, [profileId]);
  }

  /** Borrado de cuenta: sus negocios desaparecen con sus posts (la tabla conserva el handle para que nadie lo suplante). */
  async deleteBusinessesOf(q: Queryable, userId: string): Promise<void> {
    const { rows } = await q.query<{ id: string }>(
      `UPDATE social.business_profiles SET deleted_at = coalesce(deleted_at, now()), description = NULL, address_public = NULL,
              contact_phone = NULL, contact_url = NULL, updated_at = now()
        WHERE owner_user_id = $1 RETURNING id`,
      [userId],
    );
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return;
    await q.query(`UPDATE social.posts SET text = NULL, deleted_at = coalesce(deleted_at, now()), updated_at = now() WHERE author_type = 'BUSINESS' AND author_id = ANY($1)`, [ids]);
    await q.query(`DELETE FROM social.follows WHERE target_type = 'BUSINESS' AND target_id = ANY($1::text[])`, [ids]);
  }

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
    const base = textFingerprintBase(input.text);
    const textHash = base ? createHash("sha256").update(base).digest("hex") : null;
    await tx.query(
      `INSERT INTO social.posts (id, author_type, author_id, kind, author_visibility, text, category_code, public_point, text_hash, shared_post_id, lang, visible_after)
       VALUES ($1, $9, $2, $3, $4, $5, $8,
               CASE WHEN $6::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography END, $10, $11, $12,
               CASE WHEN $13::int > 0 THEN now() + make_interval(mins => $13::int) END)`,
      [id, input.businessId ?? input.authorProfileId, input.kind, input.businessId ? "PUBLIC" : input.authorVisibility, input.text,
        input.publicPoint?.lng ?? null, input.publicPoint?.lat ?? null, input.categoryCode ?? null, input.businessId ? "BUSINESS" : "PROFILE", textHash, input.sharedPostId ?? null,
        // Idioma detectado en el servidor, sin modelo externo (ADR 0091).
        detectLanguage(input.text), input.visibleAfterMinutes ?? 0],
    );
    if (textHash) await this.detectDuplicateText(tx, textHash);
    // Un negocio publica su propio teléfono y correo a propósito: solo se revisan documentos y tarjetas.
    if (input.text) await this.detectPersonalData(tx, "POST", id, input.text, input.businessId ? ["ID_DOCUMENT", "PAYMENT_CARD"] : null);
    return id;
  }

  /**
   * Datos personales en el texto (ADR 0088, doxxing §13.3): va a la cola de moderación con los TIPOS detectados,
   * nunca con el dato. No se oculta solo: decide una persona (puede ser el teléfono de un albergue).
   */
  private async detectPersonalData(
    q: Queryable, targetType: "POST" | "COMMENT", targetId: string, text: string, only: readonly string[] | null,
  ): Promise<void> {
    const kinds = detectPersonalData(text, this.publicNumbers).filter((k) => !only || only.includes(k));
    if (kinds.length) await publish(q, "PersonalDataDetected", { targetType, targetId, kinds });
  }

  /**
   * Spam coordinado (ADR 0031): si varias cuentas distintas publican el mismo texto en pocas horas, todos esos
   * posts van a la cola de moderación. Nada se oculta solo: decide una persona (un aviso real reenviado de
   * buena fe también coincide).
   */
  private async detectDuplicateText(tx: Queryable, textHash: string): Promise<void> {
    const { rows } = await tx.query<{ ids: string[]; authors: number }>(
      `SELECT (array_agg(id ORDER BY created_at DESC))[1:$3] AS ids, count(DISTINCT (author_type, author_id))::int AS authors
         FROM social.posts
        WHERE text_hash = $1 AND created_at > now() - make_interval(hours => $2) AND deleted_at IS NULL`,
      [textHash, DUPLICATE_TEXT.windowHours, DUPLICATE_TEXT.maxPosts],
    );
    const r = rows[0];
    if (r && r.authors >= DUPLICATE_TEXT.minAuthors) await publish(tx, "DuplicateTextDetected", { postIds: r.ids });
  }

  /** Original que se puede compartir: público y visible. Si es un SHARE, su original. */
  async shareTarget(q: Queryable, postId: string): Promise<{ id: string; categoryCode: string | null }> {
    const { rows } = await q.query<{ id: string; category_code: string | null }>(
      `SELECT o.id, o.category_code
         FROM social.posts p JOIN social.posts o ON o.id = coalesce(p.shared_post_id, p.id)
        WHERE p.id = $1 AND o.deleted_at IS NULL AND o.visibility = 'PUBLIC' AND o.moderation_state = 'VISIBLE'`,
      [postId],
    );
    if (!rows[0]) throw notFound("Publicación");
    return { id: rows[0].id, categoryCode: rows[0].category_code };
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

  async mediaOfPost(q: Queryable, postId: string): Promise<string[]> {
    const { rows } = await q.query<{ media_id: string }>(`SELECT media_id FROM social.post_media WHERE post_id = $1 ORDER BY position`, [postId]);
    return rows.map((r) => r.media_id);
  }

  async postsWithMedia(q: Queryable, mediaId: string): Promise<string[]> {
    const { rows } = await q.query<{ post_id: string }>(`SELECT post_id FROM social.post_media WHERE media_id = $1`, [mediaId]);
    return rows.map((r) => r.post_id);
  }

  async linkPostToEvent(tx: Queryable, postId: string, eventId: string, linkType: "REPORT" | "MENTION" | "UPDATE"): Promise<void> {
    await tx.query(
      `INSERT INTO social.post_event_links (post_id, event_id, link_type) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [postId, eventId, linkType],
    );
  }

  /** División de un evento: los posts de los reportes separados pasan al evento nuevo. */
  async relinkPosts(tx: Queryable, postIds: string[], fromEventId: string, toEventId: string): Promise<void> {
    if (postIds.length === 0) return;
    await tx.query(`UPDATE social.post_event_links SET event_id = $3 WHERE post_id = ANY($1) AND event_id = $2`, [postIds, fromEventId, toEventId]);
  }

  /** Vista pública de un post: si es seudónimo, no revela el autor. */
  async getPost(q: Queryable, postId: string) {
    const { rows } = await q.query<{
      id: string; kind: string; text: string | null; author_visibility: string; handle: string; created_at: Date;
      lat: number | null; lng: number | null;
    }>(
      `SELECT p.id, p.kind, p.text, p.author_visibility, coalesce(pr.handle, bp.handle) AS handle, p.created_at,
              ST_Y(p.public_point::geometry) AS lat, ST_X(p.public_point::geometry) AS lng
         FROM social.posts p
           LEFT JOIN social.profiles pr ON p.author_type = 'PROFILE' AND pr.id = p.author_id
           LEFT JOIN social.business_profiles bp ON p.author_type = 'BUSINESS' AND bp.id = p.author_id
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
    const where = [`p.deleted_at IS NULL`, `p.visibility = 'PUBLIC'`, `p.moderation_state = 'VISIBLE'`,
      // Retraso de publicación (ADR 0099): hasta su hora, solo su autor lo ve.
      `(p.visible_after IS NULL OR p.visible_after <= now() OR (p.author_type = 'PROFILE' AND p.author_id = $2))`];
    // Bloqueos: se ocultan los posts con nombre del bloqueado. Los seudónimos se mantienen: pueden ser avisos de
    // seguridad y ocultarlos no aporta nada (el bloqueador no sabe quién los escribió).
    if (f.viewerProfileId) {
      where.push(`NOT (p.author_type = 'PROFILE' AND p.author_visibility = 'PUBLIC' AND EXISTS (SELECT 1 FROM social.blocks b WHERE b.blocker_profile_id = $2 AND b.blocked_profile_id = p.author_id))`);
      where.push(`NOT (p.author_type = 'BUSINESS' AND EXISTS (SELECT 1 FROM social.business_blocks bb WHERE bb.blocker_profile_id = $2 AND bb.business_id = p.author_id))`);
    }
    const nearSql = f.near ? `ST_SetSRID(ST_MakePoint($${params.push(f.near.lng)}, $${params.push(f.near.lat)}), 4326)::geography` : null;
    if (f.category) {
      where.push(`(p.category_code = $${params.push(f.category)} OR p.category_code LIKE $${params.push(`${f.category}.%`)})`);
    }
    if (f.authorProfileId) where.push(`p.author_type = 'PROFILE' AND p.author_id = $${params.push(f.authorProfileId)}::uuid AND p.author_visibility = 'PUBLIC'`);
    if (f.authorBusinessId) where.push(`p.author_type = 'BUSINESS' AND p.author_id = $${params.push(f.authorBusinessId)}::uuid`);
    // Un negocio retirado o borrado deja de aparecer con todos sus posts.
    where.push(`(p.author_type = 'PROFILE' OR (bp.deleted_at IS NULL AND bp.moderation_state = 'VISIBLE'))`);
    if (f.ids) where.push(`p.id = ANY($${params.push(f.ids)}::uuid[])`);
    if (f.eventId) where.push(`EXISTS (SELECT 1 FROM social.post_event_links l2 WHERE l2.post_id = p.id AND l2.event_id = $${params.push(f.eventId)}::uuid)`);
    if (f.tag) {
      where.push(`EXISTS (SELECT 1 FROM social.post_tags pt JOIN social.tags tg ON tg.id = pt.tag_id WHERE pt.post_id = p.id AND tg.normalized = $${params.push(f.tag)})`);
    }
    if (f.tab === "nearby" && nearSql) where.push(`ST_DWithin(p.public_point, ${nearSql}, $${params.push(f.nearRadiusM ?? 25_000)})`);
    if (f.tab === "videos") where.push(`EXISTS (SELECT 1 FROM social.post_media v WHERE v.post_id = p.id AND v.kind = 'VIDEO_RECORDED')`);
    if (f.tab === "following") {
      const followed = (type: string) => `(SELECT target_id FROM social.follows WHERE follower_profile_id = $2 AND target_type = '${type}')`;
      where.push(`((p.author_visibility = 'PUBLIC' AND p.author_type = 'PROFILE' AND p.author_id::text IN ${followed("PROFILE")})
                   OR (p.author_type = 'BUSINESS' AND p.author_id::text IN ${followed("BUSINESS")})
                   OR le.event_id::text IN ${followed("EVENT")}
                   OR s.region_id IN ${followed("PLACE")} OR s.district_id IN ${followed("PLACE")}
                   OR EXISTS (SELECT 1 FROM social.post_tags pt JOIN social.tags tg ON tg.id = pt.tag_id
                               WHERE pt.post_id = p.id AND tg.normalized IN ${followed("TAG")}))`);
    }
    const ranked = f.tab === "for_you" && !f.authorProfileId && !f.authorBusinessId && !f.tag && !f.eventId && !f.ids;
    if (ranked) where.push(`p.created_at > now() - make_interval(days => ${FOR_YOU_WINDOW_DAYS})`);
    const score = ranked ? rankSql(nearSql) : `extract(epoch FROM p.created_at) / 3600.0`;
    const cursor = f.cursor ? `WHERE (x.score, x.id) < ($${params.push(f.cursor.score)}::float8, $${params.push(f.cursor.id)}::uuid)` : "";

    const { rows } = await q.query<{
      id: string; kind: FeedRow["kind"]; author_visibility: string; handle: string; display_name: string; text: string | null; lang: string | null;
      created_at: Date; category_code: string | null; event_id: string | null; distance_m: number | null; score: number;
      media: { id: string; kind: "IMAGE" | "VIDEO_RECORDED" }[] | null; reactions: ReactionCounts | null; my_reactions: ReactionKind[]; comment_count: number; shared_post_id: string | null; share_count: number;
      mentions: string[]; business_mentions: string[]; mine: boolean | null; business_verification: "UNVERIFIED" | "VERIFIED" | "INSTITUTIONAL_OFFICIAL" | null;
    }>(
      `WITH x AS (
         SELECT p.id, p.author_id, p.author_type, p.kind, p.author_visibility, coalesce(pr.handle, bp.handle) AS handle,
                coalesce(pr.display_name, bp.name) AS display_name, bp.verification_status AS business_verification, p.text, p.lang, p.created_at, p.category_code, le.event_id,
                p.shared_post_id,
                ${nearSql ? `ST_Distance(p.public_point, ${nearSql})` : "NULL"}::float8 AS distance_m,
                (${score})::float8 AS score
           FROM social.posts p
           LEFT JOIN social.profiles pr ON p.author_type = 'PROFILE' AND pr.id = p.author_id
           LEFT JOIN social.business_profiles bp ON p.author_type = 'BUSINESS' AND bp.id = p.author_id
           LEFT JOIN LATERAL (SELECT l.event_id FROM social.post_event_links l WHERE l.post_id = p.id ORDER BY l.created_at LIMIT 1) le ON true
           LEFT JOIN social.event_signals s ON s.event_id = le.event_id
          WHERE ${where.join(" AND ")}
       )
       SELECT x.*,
              (SELECT json_agg(json_build_object('id', m.media_id, 'kind', m.kind) ORDER BY m.position)
                 FROM social.post_media m WHERE m.post_id = x.id) AS media,
              (SELECT json_object_agg(g.kind, g.n) FROM (SELECT r.kind, count(*)::int AS n FROM social.reactions r
                 WHERE r.post_id = x.id GROUP BY r.kind) g) AS reactions,
              (SELECT count(*) FROM social.comments c WHERE c.post_id = x.id AND c.deleted_at IS NULL AND c.moderation_state = 'VISIBLE')::int AS comment_count,
              (SELECT count(*) FROM social.posts sp WHERE sp.shared_post_id = x.id AND sp.deleted_at IS NULL AND sp.moderation_state = 'VISIBLE')::int AS share_count,
              (SELECT coalesce(array_agg(r.kind ORDER BY r.kind), '{}') FROM social.reactions r WHERE r.post_id = x.id AND r.profile_id = $2) AS my_reactions,
              (SELECT coalesce(array_agg(mp.handle ORDER BY mp.handle), '{}') FROM social.post_mentions pm
                 JOIN social.profiles mp ON mp.id = pm.profile_id WHERE pm.post_id = x.id AND mp.deleted_at IS NULL) AS mentions,
              (SELECT coalesce(array_agg(mb.handle ORDER BY mb.handle), '{}') FROM social.post_business_mentions pbm
                 JOIN social.business_profiles mb ON mb.id = pbm.business_id
                WHERE pbm.post_id = x.id AND mb.deleted_at IS NULL AND mb.moderation_state = 'VISIBLE') AS business_mentions,
              CASE WHEN x.author_type = 'PROFILE' THEN x.author_id = $2
                   ELSE EXISTS (SELECT 1 FROM social.business_profiles ob JOIN social.profiles op ON op.user_id = ob.owner_user_id
                                 WHERE ob.id = x.author_id AND op.id = $2) END AS mine
         FROM x ${cursor}
        ORDER BY x.score DESC, x.id DESC
        LIMIT $1`,
      params,
    );
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      author: r.author_visibility === "PSEUDONYMOUS"
        ? { pseudonymous: true }
        : { pseudonymous: false, handle: r.handle, displayName: r.display_name, ...(r.business_verification ? { business: { verification: r.business_verification } } : {}) },
      text: r.text,
      lang: r.lang,
      createdAt: r.created_at,
      categoryCode: r.category_code,
      eventId: r.event_id,
      distanceM: r.distance_m,
      score: r.score,
      media: r.media ?? [],
      likeCount: r.reactions?.LIKE ?? 0,
      commentCount: r.comment_count,
      likedByMe: r.my_reactions.includes("LIKE"),
      reactions: r.reactions ?? {},
      myReactions: r.my_reactions,
      sharedPostId: r.shared_post_id,
      shareCount: r.share_count,
      mentions: [...r.mentions, ...r.business_mentions].sort(),
      businessMentions: r.business_mentions,
      mine: r.mine === true,
    }));
  }

  // ───────────── Etiquetas y menciones (ADR 0027) ─────────────

  /**
   * Indexa las etiquetas y menciones del texto de un post. Solo se enlazan menciones a perfiles existentes y que
   * no hayan bloqueado al autor; la persona que escribe no se menciona a sí misma.
   */
  async indexPostText(tx: Queryable, postId: string, authorProfileId: string, text: string | null): Promise<{ tags: string[]; mentions: string[] }> {
    const tags = extractTags(text);
    for (const t of tags) {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO social.tags (id, normalized, display) VALUES ($1, $2, $3)
         ON CONFLICT (normalized) DO UPDATE SET normalized = EXCLUDED.normalized RETURNING id`,
        [newId(), t.normalized, t.display],
      );
      await tx.query(`INSERT INTO social.post_tags (post_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [postId, rows[0]!.id]);
    }
    const handles = extractMentions(text);
    const mentioned = handles.length === 0 ? [] : (await tx.query<{ profile_id: string; handle: string }>(
      `INSERT INTO social.post_mentions (post_id, profile_id)
       SELECT $1, pr.id FROM social.profiles pr
        WHERE lower(pr.handle) = ANY($2) AND pr.deleted_at IS NULL AND pr.id <> $3
          AND NOT EXISTS (SELECT 1 FROM social.blocks b WHERE b.blocker_profile_id = pr.id AND b.blocked_profile_id = $3)
       ON CONFLICT DO NOTHING
       RETURNING profile_id, (SELECT handle FROM social.profiles WHERE id = profile_id) AS handle`,
      [postId, handles, authorProfileId],
    )).rows;
    // Solo las menciones recién enlazadas: el Alert Engine decide si avisa (ADR 0063).
    if (mentioned.length > 0) {
      await publish(tx, "UserMentioned", { postId, authorProfileId, profileIds: mentioned.map((m) => m.profile_id) }, { lane: "interactive" });
    }
    // Negocios (ADR 0054): el handle es único entre personas y negocios, así que no hay ambigüedad.
    const businesses = handles.length === 0 ? [] : (await tx.query<{ handle: string }>(
      `INSERT INTO social.post_business_mentions (post_id, business_id)
       SELECT $1, b.id FROM social.business_profiles b
        WHERE lower(b.handle) = ANY($2) AND b.deleted_at IS NULL AND b.moderation_state = 'VISIBLE'
       ON CONFLICT DO NOTHING
       RETURNING (SELECT handle FROM social.business_profiles WHERE id = business_id)`,
      [postId, handles],
    )).rows;
    return { tags: tags.map((t) => t.normalized), mentions: [...mentioned, ...businesses].map((m) => m.handle) };
  }

  /**
   * Para el aviso de mención (ADR 0063): si el post sigue visible, cómo nombrar a quien lo escribió (null si es
   * seudónimo: el aviso no lo revela) y cuáles de las personas mencionadas pueden recibirlo (siguen existiendo, no
   * bloquearon a la persona ni al negocio autor).
   */
  async mentionContext(q: Queryable, postId: string, profileIds: string[]): Promise<{ authorHandle: string | null; recipients: string[] } | null> {
    const { rows } = await q.query<{ author_type: string; author_id: string; author_visibility: string; handle: string | null }>(
      `SELECT p.author_type, p.author_id, p.author_visibility, coalesce(pr.handle, bp.handle) AS handle
         FROM social.posts p
         LEFT JOIN social.profiles pr ON p.author_type = 'PROFILE' AND pr.id = p.author_id
         LEFT JOIN social.business_profiles bp ON p.author_type = 'BUSINESS' AND bp.id = p.author_id
        WHERE p.id = $1 AND p.deleted_at IS NULL AND p.moderation_state = 'VISIBLE' AND p.visibility = 'PUBLIC'`,
      [postId],
    );
    const post = rows[0];
    if (!post) return null;
    const ok = await q.query<{ id: string }>(
      `SELECT pr.id FROM social.profiles pr
        WHERE pr.id = ANY($1) AND pr.deleted_at IS NULL
          AND NOT ($2 = 'PROFILE' AND EXISTS (SELECT 1 FROM social.blocks b WHERE b.blocker_profile_id = pr.id AND b.blocked_profile_id = $3))
          AND NOT ($2 = 'BUSINESS' AND EXISTS (SELECT 1 FROM social.business_blocks bb WHERE bb.blocker_profile_id = pr.id AND bb.business_id = $3))`,
      [profileIds, post.author_type, post.author_id],
    );
    return { authorHandle: post.author_visibility === "PSEUDONYMOUS" ? null : post.handle, recipients: ok.rows.map((r) => r.id) };
  }

  async tag(q: Queryable, normalized: string, viewerProfileId: string | null): Promise<TagView> {
    // Una etiqueta que nadie ha usado aún existe igual: se puede seguir antes del primer post.
    const { rows } = await q.query<{ display: string | null; posts: number; followers: number; followed: boolean }>(
      `SELECT (SELECT display FROM social.tags WHERE normalized = $1) AS display,
              (SELECT count(*) FROM social.post_tags pt JOIN social.tags t ON t.id = pt.tag_id JOIN social.posts p ON p.id = pt.post_id
                WHERE t.normalized = $1 AND p.deleted_at IS NULL AND p.visibility = 'PUBLIC' AND p.moderation_state = 'VISIBLE')::int AS posts,
              (SELECT count(*) FROM social.follows f WHERE f.target_type = 'TAG' AND f.target_id = $1)::int AS followers,
              EXISTS (SELECT 1 FROM social.follows f WHERE f.target_type = 'TAG' AND f.target_id = $1 AND f.follower_profile_id = $2) AS followed`,
      [normalized, viewerProfileId],
    );
    const r = rows[0]!;
    return { tag: normalized, display: r.display ?? normalized, postCount: r.posts, followerCount: r.followers, followedByMe: r.followed };
  }

  /** Búsqueda por prefijo, las más usadas primero (índice text_pattern_ops). */
  async searchTags(q: Queryable, prefix: string, viewerProfileId: string | null, limit: number): Promise<TagView[]> {
    const { rows } = await q.query<{ normalized: string }>(
      `SELECT t.normalized FROM social.tags t
        WHERE t.normalized LIKE $1 || '%'
        ORDER BY (SELECT count(*) FROM social.post_tags pt WHERE pt.tag_id = t.id) DESC, t.normalized
        LIMIT $2`,
      [prefix.replace(/[\\%_]/g, "\\$&"), limit],
    );
    return Promise.all(rows.map((r) => this.tag(q, r.normalized, viewerProfileId)));
  }

  /**
   * La persona borra su post. Solo los posts sin reporte: un REPORT es evidencia de un EVENT y se retira por
   * moderación o al borrar la cuenta. Devuelve la media adjunta para que el Media Engine la elimine.
   */
  async deletePost(q: Queryable, postId: string, profileId: string, opts: { withdrawReport?: boolean } = {}): Promise<{ mediaIds: string[] }> {
    const { rows } = await q.query<{ kind: string; deleted: boolean; mine: boolean }>(
      `SELECT p.kind, p.deleted_at IS NOT NULL AS deleted,
              CASE WHEN p.author_type = 'PROFILE' THEN p.author_id = $2
                   ELSE EXISTS (SELECT 1 FROM social.business_profiles ob JOIN social.profiles op ON op.user_id = ob.owner_user_id
                                 WHERE ob.id = p.author_id AND op.id = $2) END AS mine
         FROM social.posts p WHERE p.id = $1 FOR UPDATE`,
      [postId, profileId],
    );
    const r = rows[0];
    if (!r || r.deleted || !r.mine) throw notFound("Post");
    if (r.kind === "REPORT" && !opts.withdrawReport) throw new DomainError("REPORT_POST", "Un reporte no se borra desde aquí: forma parte de la evidencia de un evento", 409);
    await q.query(`UPDATE social.posts SET text = NULL, public_point = NULL, deleted_at = now(), updated_at = now() WHERE id = $1`, [postId]);
    await q.query(`DELETE FROM social.post_tags WHERE post_id = $1`, [postId]);
    await q.query(`DELETE FROM social.post_mentions WHERE post_id = $1`, [postId]);
    await q.query(`DELETE FROM social.post_business_mentions WHERE post_id = $1`, [postId]);
    await q.query(`DELETE FROM social.reactions WHERE post_id = $1`, [postId]);
    const media = await q.query<{ media_id: string }>(`SELECT media_id FROM social.post_media WHERE post_id = $1`, [postId]);
    return { mediaIds: media.rows.map((m) => m.media_id) };
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
      `INSERT INTO social.follows (follower_profile_id, target_type, target_id) VALUES ($1, $2, $3)
       ON CONFLICT (follower_profile_id, target_type, target_id) DO UPDATE SET via_merge = NULL`,
      [followerProfileId, type, targetId],
    );
  }

  async follows(q: Queryable, profileId: string): Promise<{ type: FollowType; targetId: string; handle: string | null; displayName: string | null }[]> {
    const { rows } = await q.query<{ target_type: FollowType; target_id: string; handle: string | null; display_name: string | null }>(
      `SELECT f.target_type, f.target_id, pr.handle, coalesce(pr.display_name, tg.display) AS display_name
         FROM social.follows f
         LEFT JOIN social.profiles pr ON f.target_type = 'PROFILE' AND pr.id::text = f.target_id
         LEFT JOIN social.tags tg ON f.target_type = 'TAG' AND tg.normalized = f.target_id
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
    const { rows } = await q.query<{ id: string }>(`SELECT id FROM social.profiles WHERE lower(handle) = lower($1) AND deleted_at IS NULL`, [handle]);
    if (!rows[0]) throw notFound("Perfil");
    return rows[0].id;
  }

  /** Perfil público: los contadores solo incluyen posts con autoría pública. */
  async profile(q: Queryable, handle: string, viewerProfileId: string | null): Promise<ProfileView & { id: string }> {
    const { rows } = await q.query<{
      id: string; handle: string; display_name: string; bio: string | null; created_at: Date; followers: number; following: number; posts: number; followed: boolean; blocked: boolean;
    }>(
      `SELECT pr.id, pr.handle, pr.display_name, pr.bio, pr.created_at,
              (SELECT count(*) FROM social.follows f WHERE f.target_type = 'PROFILE' AND f.target_id = pr.id::text)::int AS followers,
              (SELECT count(*) FROM social.follows f WHERE f.follower_profile_id = pr.id AND f.target_type = 'PROFILE')::int AS following,
              (SELECT count(*) FROM social.posts p WHERE p.author_type = 'PROFILE' AND p.author_id = pr.id AND p.author_visibility = 'PUBLIC' AND p.visibility = 'PUBLIC'
                  AND p.deleted_at IS NULL AND p.moderation_state = 'VISIBLE')::int AS posts,
              EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_profile_id = $2 AND f.target_type = 'PROFILE' AND f.target_id = pr.id::text) AS followed,
              EXISTS (SELECT 1 FROM social.blocks b WHERE b.blocker_profile_id = $2 AND b.blocked_profile_id = pr.id) AS blocked
         FROM social.profiles pr WHERE lower(pr.handle) = lower($1) AND pr.deleted_at IS NULL`,
      [handle, viewerProfileId],
    );
    const r = rows[0];
    if (!r) throw notFound("Perfil");
    return {
      id: r.id, handle: r.handle, displayName: r.display_name, bio: r.bio, createdAt: r.created_at.toISOString(),
      followerCount: r.followers, followingCount: r.following, postCount: r.posts, followedByMe: r.followed, blockedByMe: r.blocked, isMe: r.id === viewerProfileId,
    };
  }

  /** Ajustes propios del perfil (no públicos). */
  async settings(q: Queryable, profileId: string): Promise<{ units: Units; country: string | null }> {
    const { rows } = await q.query<{ units: Units; home_country: string | null }>(
      `SELECT units, home_country FROM social.profiles WHERE id = $1 AND deleted_at IS NULL`, [profileId]);
    if (!rows[0]) throw notFound("Perfil");
    return { units: rows[0].units, country: rows[0].home_country?.trim() ?? null };
  }

  /** Editar mi perfil (ADR 0044). La bio vacía se guarda como NULL. */
  async updateProfile(q: Queryable, profileId: string, patch: UpdateProfileRequest): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [profileId];
    if (patch.displayName !== undefined) sets.push(`display_name = $${params.push(patch.displayName)}`);
    if (patch.bio !== undefined) sets.push(`bio = $${params.push(patch.bio ? patch.bio : null)}`);
    if (patch.units !== undefined) sets.push(`units = $${params.push(patch.units)}`);
    if (patch.country !== undefined) sets.push(`home_country = $${params.push(patch.country)}`);
    const res = await q.query(`UPDATE social.profiles SET ${sets.join(", ")}, updated_at = now() WHERE id = $1 AND deleted_at IS NULL`, params);
    if (res.rowCount === 0) throw notFound("Perfil");
  }

  /** Busca personas por handle o nombre (prefijo de palabra). Primero coincidencias exactas y cuentas más seguidas. */
  async searchProfiles(q: Queryable, text: string, viewerProfileId: string | null, limit: number): Promise<ProfileSearchResult[]> {
    const key = text.toLowerCase().replace(/^@/, "").replace(/[\\%_]/g, "\\$&");
    const { rows } = await q.query<{ handle: string; display_name: string; followers: number; followed: boolean }>(
      `SELECT pr.handle, pr.display_name,
              (SELECT count(*) FROM social.follows f WHERE f.target_type = 'PROFILE' AND f.target_id = pr.id::text)::int AS followers,
              EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_profile_id = $2 AND f.target_type = 'PROFILE' AND f.target_id = pr.id::text) AS followed
         FROM social.profiles pr
        WHERE pr.deleted_at IS NULL
          AND (lower(pr.handle) LIKE $1 || '%' OR lower(pr.display_name) LIKE $1 || '%' OR lower(pr.display_name) LIKE '% ' || $1 || '%')
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
    const r = await this.setReaction(q, postId, profileId, "LIKE", liked);
    return { likeCount: r.reactions.LIKE ?? 0, likedByMe: r.myReactions.includes("LIKE") };
  }

  /**
   * Reacción de contexto (ADR 0040), idempotente. "Yo también lo vi" solo en posts ligados a un evento. Es social:
   * no publica evidencia ni toca la verificación.
   */
  async setReaction(q: Queryable, postId: string, profileId: string, kind: ReactionKind, on: boolean): Promise<ReactionState> {
    await this.assertVisible(q, postId);
    if (on && kind === "SEEN_TOO") {
      const linked = await q.query(`SELECT 1 FROM social.post_event_links WHERE post_id = $1 LIMIT 1`, [postId]);
      if (linked.rowCount === 0) throw new DomainError("REACTION_NOT_APPLICABLE", "Solo se puede marcar en publicaciones sobre un evento", 422);
    }
    if (on) {
      await q.query(`INSERT INTO social.reactions (post_id, profile_id, kind) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [postId, profileId, kind]);
    } else {
      await q.query(`DELETE FROM social.reactions WHERE post_id = $1 AND profile_id = $2 AND kind = $3`, [postId, profileId, kind]);
    }
    const { rows } = await q.query<{ kind: ReactionKind; n: number; mine: boolean }>(
      `SELECT kind, count(*)::int AS n, bool_or(profile_id = $2) AS mine FROM social.reactions WHERE post_id = $1 GROUP BY kind`,
      [postId, profileId],
    );
    return {
      reactions: Object.fromEntries(rows.map((r) => [r.kind, r.n])) as ReactionCounts,
      myReactions: rows.filter((r) => r.mine).map((r) => r.kind).sort(),
    };
  }

  async addComment(q: Queryable, postId: string, profileId: string, text: string, parentId?: string): Promise<CommentView> {
    await this.assertVisible(q, postId);
    const recent = await q.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM social.comments WHERE author_profile_id = $1 AND created_at > now() - interval '1 minute'`,
      [profileId],
    );
    if (recent.rows[0]!.n >= 10) throw new DomainError("RATE_LIMITED", "Demasiados comentarios seguidos", 429);
    let parent: string | null = null;
    if (parentId) {
      // Un solo nivel: responder a una respuesta cuelga del comentario raíz.
      const p = await q.query<{ root: string }>(
        `SELECT coalesce(parent_comment_id, id) AS root FROM social.comments
          WHERE id = $1 AND post_id = $2 AND deleted_at IS NULL AND moderation_state = 'VISIBLE'`,
        [parentId, postId],
      );
      if (!p.rows[0]) throw notFound("Comentario");
      parent = p.rows[0].root;
    }
    const id = newId();
    await q.query(`INSERT INTO social.comments (id, post_id, author_profile_id, text, parent_comment_id) VALUES ($1, $2, $3, $4, $5)`, [id, postId, profileId, text, parent]);
    await this.detectPersonalData(q, "COMMENT", id, text, null);
    return (await this.comments(q, postId, profileId)).find((c) => c.id === id)!;
  }

  async comments(q: Queryable, postId: string, viewerProfileId: string | null = null): Promise<CommentView[]> {
    await this.assertVisible(q, postId);
    const { rows } = await q.query<{
      id: string; parent_comment_id: string | null; handle: string; display_name: string; text: string; created_at: Date; mine: boolean;
      reactions: ReactionCounts | null; my_reactions: ReactionKind[];
    }>(
      `SELECT c.id, c.parent_comment_id, pr.handle, pr.display_name, c.text, c.created_at, c.author_profile_id = $2 AS mine,
              (SELECT json_object_agg(g.kind, g.n) FROM (SELECT r.kind, count(*)::int AS n FROM social.comment_reactions r
                 WHERE r.comment_id = c.id GROUP BY r.kind) g) AS reactions,
              (SELECT coalesce(array_agg(r.kind ORDER BY r.kind), '{}') FROM social.comment_reactions r WHERE r.comment_id = c.id AND r.profile_id = $2) AS my_reactions
         FROM social.comments c JOIN social.profiles pr ON pr.id = c.author_profile_id
        WHERE c.post_id = $1 AND c.deleted_at IS NULL AND c.moderation_state = 'VISIBLE'
          AND NOT EXISTS (SELECT 1 FROM social.blocks b WHERE b.blocker_profile_id = $2 AND b.blocked_profile_id = c.author_profile_id)
        ORDER BY c.created_at, c.id LIMIT 200`,
      [postId, viewerProfileId],
    );
    return rows.map((r) => ({
      id: r.id, parentId: r.parent_comment_id, author: { handle: r.handle, displayName: r.display_name }, text: r.text,
      createdAt: r.created_at.toISOString(), mine: r.mine === true, reactions: r.reactions ?? {}, myReactions: r.my_reactions,
    }));
  }

  /** Borrar mi comentario (ADR 0045). Sus respuestas quedan visibles, sin el comentario al que respondían. */
  async deleteComment(q: Queryable, commentId: string, profileId: string): Promise<void> {
    const res = await q.query(
      `UPDATE social.comments SET deleted_at = now() WHERE id = $1 AND author_profile_id = $2 AND deleted_at IS NULL`,
      [commentId, profileId],
    );
    if (res.rowCount === 0) {
      const gone = await q.query(`SELECT 1 FROM social.comments WHERE id = $1 AND author_profile_id = $2`, [commentId, profileId]);
      if (gone.rowCount === 0) throw notFound("Comentario"); // no existe o no es tuyo (misma respuesta)
    }
    await q.query(`DELETE FROM social.comment_reactions WHERE comment_id = $1`, [commentId]);
  }

  /** Reacción en un comentario visible, idempotente. */
  async setCommentReaction(q: Queryable, commentId: string, profileId: string, kind: CommentReactionKind, on: boolean): Promise<ReactionState> {
    const c = await q.query<{ post_id: string }>(
      `SELECT post_id FROM social.comments WHERE id = $1 AND deleted_at IS NULL AND moderation_state = 'VISIBLE'`, [commentId],
    );
    if (!c.rows[0]) throw notFound("Comentario");
    await this.assertVisible(q, c.rows[0].post_id);
    if (on) {
      await q.query(`INSERT INTO social.comment_reactions (comment_id, profile_id, kind) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [commentId, profileId, kind]);
    } else {
      await q.query(`DELETE FROM social.comment_reactions WHERE comment_id = $1 AND profile_id = $2 AND kind = $3`, [commentId, profileId, kind]);
    }
    const { rows } = await q.query<{ kind: ReactionKind; n: number; mine: boolean }>(
      `SELECT kind, count(*)::int AS n, bool_or(profile_id = $2) AS mine FROM social.comment_reactions WHERE comment_id = $1 GROUP BY kind`,
      [commentId, profileId],
    );
    return {
      reactions: Object.fromEntries(rows.map((r) => [r.kind, r.n])) as ReactionCounts,
      myReactions: rows.filter((r) => r.mine).map((r) => r.kind).sort(),
    };
  }

  // ───────────── Bloqueos ─────────────

  /** Bloquear también deja de seguir en ambos sentidos. Desbloquear no restaura los seguimientos. */
  async setBlock(q: Queryable, blockerProfileId: string, blockedProfileId: string, block: boolean): Promise<void> {
    if (blockerProfileId === blockedProfileId) throw new DomainError("VALIDATION", "No puedes bloquearte");
    if (!block) {
      await q.query(`DELETE FROM social.blocks WHERE blocker_profile_id = $1 AND blocked_profile_id = $2`, [blockerProfileId, blockedProfileId]);
      return;
    }
    await q.query(`INSERT INTO social.blocks (blocker_profile_id, blocked_profile_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [blockerProfileId, blockedProfileId]);
    await q.query(
      `DELETE FROM social.follows WHERE target_type = 'PROFILE'
         AND ((follower_profile_id = $1 AND target_id = $4) OR (follower_profile_id = $2 AND target_id = $3))`,
      [blockerProfileId, blockedProfileId, blockerProfileId, blockedProfileId],
    );
  }

  /**
   * Bloquear por handle: una persona o un negocio (ADR 0054). Bloquear un negocio oculta sus posts y deja de
   * seguirlo; quien lo administra no se entera. No se puede bloquear un negocio propio.
   */
  async setBlockByHandle(q: Queryable, blocker: { userId: string; profileId: string }, handle: string, block: boolean): Promise<void> {
    const person = await q.query<{ id: string }>(`SELECT id FROM social.profiles WHERE lower(handle) = lower($1) AND deleted_at IS NULL`, [handle]);
    if (person.rows[0]) return this.setBlock(q, blocker.profileId, person.rows[0].id, block);
    const biz = (await q.query<{ id: string; owner_user_id: string }>(
      `SELECT id, owner_user_id FROM social.business_profiles WHERE lower(handle) = lower($1) AND deleted_at IS NULL`, [handle],
    )).rows[0];
    if (!biz) throw notFound("Perfil");
    if (biz.owner_user_id === blocker.userId) throw new DomainError("VALIDATION", "No puedes bloquear tu propio negocio");
    if (!block) {
      await q.query(`DELETE FROM social.business_blocks WHERE blocker_profile_id = $1 AND business_id = $2`, [blocker.profileId, biz.id]);
      return;
    }
    await q.query(`INSERT INTO social.business_blocks (blocker_profile_id, business_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [blocker.profileId, biz.id]);
    await q.query(`DELETE FROM social.follows WHERE follower_profile_id = $1 AND target_type = 'BUSINESS' AND target_id = $2`, [blocker.profileId, biz.id]);
  }

  async blockedHandles(q: Queryable, blockerProfileId: string): Promise<string[]> {
    const { rows } = await q.query<{ handle: string }>(
      `SELECT handle FROM (
         SELECT pr.handle, b.created_at FROM social.blocks b JOIN social.profiles pr ON pr.id = b.blocked_profile_id WHERE b.blocker_profile_id = $1
         UNION ALL
         SELECT bp.handle, bb.created_at FROM social.business_blocks bb JOIN social.business_profiles bp ON bp.id = bb.business_id
          WHERE bb.blocker_profile_id = $1 AND bp.deleted_at IS NULL
       ) x ORDER BY created_at DESC`,
      [blockerProfileId],
    );
    return rows.map((r) => r.handle);
  }

  // ───────────── Moderación (la usa el módulo moderation) ─────────────

  /**
   * Objeto denunciable con su autoría interna. `authorHandle` es null si la autoría es seudónima: la moderación
   * puede actuar sobre la cuenta sin que nadie la vea.
   */
  async moderationTarget(q: Queryable, type: "POST" | "COMMENT" | "PROFILE" | "BUSINESS", id: string): Promise<{
    id: string; text: string | null; authorHandle: string | null; authorUserId: string; state: string; categoryCode: string | null; reach: number; eventId: string | null;
  } | null> {
    if (type === "BUSINESS") {
      const { rows } = await q.query<{ id: string; handle: string; name: string; description: string | null; owner_user_id: string; moderation_state: string }>(
        `SELECT id, handle, name, description, owner_user_id, moderation_state FROM social.business_profiles WHERE id = $1 AND deleted_at IS NULL`, [id],
      );
      const r = rows[0];
      return r ? { id: r.id, text: [r.name, r.description].filter(Boolean).join(" · "), authorHandle: r.handle, authorUserId: r.owner_user_id, state: r.moderation_state, categoryCode: null, reach: 0, eventId: null } : null;
    }
    if (type === "PROFILE") {
      const { rows } = await q.query<{ id: string; handle: string; display_name: string; user_id: string }>(
        `SELECT id, handle, display_name, user_id FROM social.profiles WHERE id = $1`, [id],
      );
      const r = rows[0];
      return r ? { id: r.id, text: r.display_name, authorHandle: r.handle, authorUserId: r.user_id, state: "VISIBLE", categoryCode: null, reach: 0, eventId: null } : null;
    }
    if (type === "COMMENT") {
      const { rows } = await q.query<{ id: string; text: string; handle: string; user_id: string; moderation_state: string }>(
        `SELECT c.id, c.text, pr.handle, pr.user_id, c.moderation_state FROM social.comments c JOIN social.profiles pr ON pr.id = c.author_profile_id
          WHERE c.id = $1 AND c.deleted_at IS NULL`, [id],
      );
      const r = rows[0];
      return r ? { id: r.id, text: r.text, authorHandle: r.handle, authorUserId: r.user_id, state: r.moderation_state, categoryCode: null, reach: 0, eventId: null } : null;
    }
    const { rows } = await q.query<{
      id: string; text: string | null; handle: string; user_id: string; author_visibility: string; moderation_state: string; category_code: string | null; reach: number; event_id: string | null;
    }>(
      `SELECT p.id, p.text, coalesce(pr.handle, bp.handle) AS handle, coalesce(pr.user_id, bp.owner_user_id) AS user_id,
              p.author_visibility, p.moderation_state, p.category_code,
              ((SELECT count(*) FROM social.reactions r WHERE r.post_id = p.id) + (SELECT count(*) FROM social.comments c WHERE c.post_id = p.id))::int AS reach,
              (SELECT l.event_id FROM social.post_event_links l WHERE l.post_id = p.id ORDER BY l.created_at LIMIT 1) AS event_id
         FROM social.posts p
           LEFT JOIN social.profiles pr ON p.author_type = 'PROFILE' AND pr.id = p.author_id
           LEFT JOIN social.business_profiles bp ON p.author_type = 'BUSINESS' AND bp.id = p.author_id
        WHERE p.id = $1 AND p.deleted_at IS NULL`, [id],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id, text: r.text, authorHandle: r.author_visibility === "PSEUDONYMOUS" ? null : r.handle, authorUserId: r.user_id,
      state: r.moderation_state, categoryCode: r.category_code, reach: r.reach, eventId: r.event_id,
    };
  }

  async setPostModeration(q: Queryable, postId: string, state: "VISIBLE" | "LIMITED" | "HIDDEN" | "REMOVED"): Promise<void> {
    await q.query(`UPDATE social.posts SET moderation_state = $2, updated_at = now() WHERE id = $1`, [postId, state]);
  }

  /** Para moderación: el negocio por handle aunque esté retirado. */
  async businessIdForModeration(q: Queryable, handle: string): Promise<string> {
    const { rows } = await q.query<{ id: string }>(`SELECT id FROM social.business_profiles WHERE lower(handle) = lower($1) AND deleted_at IS NULL`, [handle]);
    if (!rows[0]) throw notFound("Negocio");
    return rows[0].id;
  }

  async setBusinessModeration(q: Queryable, businessId: string, state: "VISIBLE" | "REMOVED"): Promise<void> {
    await q.query(`UPDATE social.business_profiles SET moderation_state = $2, updated_at = now() WHERE id = $1`, [businessId, state]);
  }

  async setCommentModeration(q: Queryable, commentId: string, state: "VISIBLE" | "HIDDEN" | "REMOVED"): Promise<void> {
    await q.query(`UPDATE social.comments SET moderation_state = $2 WHERE id = $1`, [commentId, state]);
  }

  private async assertVisible(q: Queryable, postId: string): Promise<void> {
    const { rowCount } = await q.query(
      `SELECT 1 FROM social.posts WHERE id = $1 AND deleted_at IS NULL AND moderation_state IN ('VISIBLE','LIMITED')`,
      [postId],
    );
    if (!rowCount) throw notFound("Post");
  }
  // ───────────── Exportación de datos personales (ADR 0038) ─────────────

  /** Perfil, publicaciones, comentarios, reacciones, seguimientos, bloqueos y negocios propios. */
  async exportData(q: Queryable, who: { userId: string; profileId: string }): Promise<Record<string, unknown[]>> {
    const p = who.profileId;
    const profile = await q.query(`SELECT id, handle, display_name, bio, home_country, locale, units, created_at FROM social.profiles WHERE id = $1`, [p]);
    const businesses = await q.query(
      `SELECT id, handle, name, category, country, verification_status, description, address_public, contact_phone, contact_url, moderation_state, created_at, deleted_at
         FROM social.business_profiles WHERE owner_user_id = $1`, [who.userId],
    );
    const posts = await q.query(
      `SELECT p.id, p.author_type, p.kind, p.author_visibility, p.text, p.category_code, p.moderation_state, p.created_at, p.deleted_at,
              ST_Y(p.public_point::geometry) AS public_lat, ST_X(p.public_point::geometry) AS public_lng,
              (SELECT coalesce(array_agg(m.media_id ORDER BY m.position), '{}') FROM social.post_media m WHERE m.post_id = p.id) AS media_ids,
              (SELECT coalesce(array_agg(l.event_id), '{}') FROM social.post_event_links l WHERE l.post_id = p.id) AS event_ids
         FROM social.posts p
        WHERE (p.author_type = 'PROFILE' AND p.author_id = $1)
           OR (p.author_type = 'BUSINESS' AND p.author_id IN (SELECT id FROM social.business_profiles WHERE owner_user_id = $2))
        ORDER BY p.created_at DESC LIMIT 10000`,
      [p, who.userId],
    );
    const comments = await q.query(`SELECT id, post_id, parent_comment_id, text, moderation_state, created_at, deleted_at FROM social.comments WHERE author_profile_id = $1 ORDER BY created_at DESC LIMIT 10000`, [p]);
    const reactions = await q.query(`SELECT post_id, kind, created_at FROM social.reactions WHERE profile_id = $1 ORDER BY created_at DESC LIMIT 10000`, [p]);
    const commentReactions = await q.query(`SELECT comment_id, kind, created_at FROM social.comment_reactions WHERE profile_id = $1 ORDER BY created_at DESC LIMIT 10000`, [p]);
    const follows = await q.query(`SELECT target_type, target_id, created_at FROM social.follows WHERE follower_profile_id = $1`, [p]);
    const blocks = await q.query(
      `SELECT pr.handle AS blocked_handle, b.created_at FROM social.blocks b JOIN social.profiles pr ON pr.id = b.blocked_profile_id WHERE b.blocker_profile_id = $1
       UNION ALL
       SELECT bp.handle, bb.created_at FROM social.business_blocks bb JOIN social.business_profiles bp ON bp.id = bb.business_id WHERE bb.blocker_profile_id = $1`, [p],
    );
    return {
      profile: profile.rows, businesses: businesses.rows, posts: posts.rows, comments: comments.rows,
      reactions: reactions.rows, commentReactions: commentReactions.rows, follows: follows.rows, blocks: blocks.rows,
    };
  }
}

export { POSTS_PER_HOUR, PostComposer } from "./composer.js";
export { BusinessService } from "./business.js";
