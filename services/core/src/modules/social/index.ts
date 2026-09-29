import type { GeoPoint } from "@dizaster/contracts";
import type { Queryable } from "../../platform/db.js";
import { notFound } from "../../platform/errors.js";
import { newId } from "../../platform/ids.js";

/**
 * Social Engine (primer corte): perfiles y posts. Un REPORT siempre tiene un POST como cara social
 * (kind = REPORT) para que comentarios, reacciones y compartir funcionen igual en todo el contenido.
 * Comentarios, reacciones, seguir, tags y feed llegan en la etapa "Red social".
 */
export interface CreatePostInput {
  authorProfileId: string;
  kind: "STANDARD" | "REPORT" | "SHARE" | "OFFICIAL_UPDATE";
  text: string | null;
  authorVisibility: "PUBLIC" | "PSEUDONYMOUS";
  /** Debe llegar YA generalizada; social nunca recibe la ubicación precisa. */
  publicPoint: GeoPoint | null;
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
      `INSERT INTO social.posts (id, author_type, author_id, kind, author_visibility, text, public_point)
       VALUES ($1, 'PROFILE', $2, $3, $4, $5,
               CASE WHEN $6::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography END)`,
      [id, input.authorProfileId, input.kind, input.authorVisibility, input.text, input.publicPoint?.lng ?? null, input.publicPoint?.lat ?? null],
    );
    return id;
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
}
