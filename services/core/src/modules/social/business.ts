import {
  BusinessSearchQuery,
  CreateBusinessRequest,
  MAX_BUSINESSES_PER_USER,
  SetBusinessVerificationRequest,
  UpdateBusinessRequest,
  type BusinessCategory,
  type BusinessVerification,
  type BusinessView,
} from "@dizaster/contracts";
import type { z } from "zod";
import type { Db, Queryable } from "../../platform/db.js";
import { DomainError, notFound } from "../../platform/errors.js";
import { newId } from "../../platform/ids.js";

interface Row {
  id: string; handle: string; name: string; category: BusinessCategory; country: string | null; description: string | null;
  address_public: string | null; contact_phone: string | null; contact_url: string | null; verification_status: BusinessVerification;
  logo_url: string | null; created_at: Date; followers: number; posts: number; followed: boolean; mine: boolean; blocked: boolean;
}

const COLUMNS = `b.id, b.handle, b.name, b.category, b.country, b.description, b.address_public, b.contact_phone, b.contact_url,
  b.verification_status, b.logo_url, b.created_at,
  (SELECT count(*) FROM social.follows f WHERE f.target_type = 'BUSINESS' AND f.target_id = b.id::text)::int AS followers,
  (SELECT count(*) FROM social.posts p WHERE p.author_type = 'BUSINESS' AND p.author_id = b.id AND p.deleted_at IS NULL
      AND p.visibility = 'PUBLIC' AND p.moderation_state = 'VISIBLE')::int AS posts,
  EXISTS (SELECT 1 FROM social.follows f WHERE f.follower_profile_id = $2 AND f.target_type = 'BUSINESS' AND f.target_id = b.id::text) AS followed,
  b.owner_user_id = $3 AS mine,
  EXISTS (SELECT 1 FROM social.business_blocks bb WHERE bb.blocker_profile_id = $2 AND bb.business_id = b.id) AS blocked`;

/**
 * Perfiles de negocio (ADR 0028). V1: una persona administra hasta 3; sin miembros adicionales todavía
 * (`BusinessMember` queda para después). La verificación la decide administración a mano y sin pago; un negocio
 * nunca crea REPORTs ciudadanos (D-04): solo publica posts.
 */
export class BusinessService {
  constructor(private readonly db: Db) {}

  async create(owner: { userId: string; profileId: string }, raw: unknown): Promise<BusinessView> {
    const b = parse(CreateBusinessRequest, raw);
    const mine = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM social.business_profiles WHERE owner_user_id = $1 AND deleted_at IS NULL`, [owner.userId],
    );
    if (mine.rows[0]!.n >= MAX_BUSINESSES_PER_USER) throw new DomainError("LIMIT_REACHED", `Puedes administrar hasta ${MAX_BUSINESSES_PER_USER} negocios`, 409);
    // Un handle es único entre personas y negocios (también los borrados: nadie puede suplantar uno antiguo).
    const taken = await this.db.query(
      `SELECT 1 FROM social.profiles WHERE lower(handle) = $1 UNION ALL SELECT 1 FROM social.business_profiles WHERE lower(handle) = $1`, [b.handle],
    );
    if (taken.rowCount) throw new DomainError("HANDLE_TAKEN", "Ese nombre de usuario ya existe", 409);
    try {
      await this.db.query(
        `INSERT INTO social.business_profiles (id, owner_user_id, handle, name, category, country, description, address_public, contact_phone, contact_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [newId(), owner.userId, b.handle, b.name, b.category, b.country ?? null, b.description ?? null, b.addressPublic ?? null, b.contactPhone ?? null, b.contactUrl ?? null],
      );
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new DomainError("HANDLE_TAKEN", "Ese nombre de usuario ya existe", 409);
      throw e;
    }
    return this.view(this.db, b.handle, owner);
  }

  async update(owner: { userId: string; profileId: string }, handle: string, raw: unknown): Promise<BusinessView> {
    const b = parse(UpdateBusinessRequest, raw);
    const { rowCount } = await this.db.query(
      `UPDATE social.business_profiles SET name = $3, category = $4, country = $5, description = $6, address_public = $7,
              contact_phone = $8, contact_url = $9, updated_at = now()
        WHERE lower(handle) = lower($1) AND owner_user_id = $2 AND deleted_at IS NULL`,
      [handle, owner.userId, b.name, b.category, b.country ?? null, b.description ?? null, b.addressPublic ?? null, b.contactPhone ?? null, b.contactUrl ?? null],
    );
    if (!rowCount) throw notFound("Negocio");
    return this.view(this.db, handle, owner);
  }

  /** Borrar el negocio: sus posts y seguidores se van con él. El handle queda reservado. */
  async delete(owner: { userId: string }, handle: string): Promise<string> {
    const id = await this.ownedId(this.db, owner.userId, handle);
    await this.db.query(`UPDATE social.business_profiles SET deleted_at = now(), logo_media_id = NULL, logo_url = NULL, updated_at = now() WHERE id = $1`, [id]);
    await this.db.query(`UPDATE social.posts SET text = NULL, deleted_at = coalesce(deleted_at, now()) WHERE author_type = 'BUSINESS' AND author_id = $1`, [id]);
    await this.db.query(`DELETE FROM social.follows WHERE target_type = 'BUSINESS' AND target_id = $1`, [id]);
    await this.db.query(`DELETE FROM social.post_business_mentions WHERE business_id = $1`, [id]);
    await this.db.query(`DELETE FROM social.business_blocks WHERE business_id = $1`, [id]);
    return id;
  }

  /** Vista pública. Un negocio retirado por moderación solo lo ve quien lo administra. */
  async view(q: Queryable, handle: string, viewer: { userId: string; profileId: string } | null): Promise<BusinessView> {
    const { rows } = await q.query<Row & { moderation_state: string }>(
      `SELECT ${COLUMNS}, b.moderation_state FROM social.business_profiles b WHERE lower(b.handle) = lower($1) AND b.deleted_at IS NULL`,
      [handle, viewer?.profileId ?? null, viewer?.userId ?? null],
    );
    const r = rows[0];
    if (!r || (r.moderation_state !== "VISIBLE" && !r.mine)) throw notFound("Negocio");
    return toView(r);
  }

  async mine(owner: { userId: string; profileId: string }): Promise<BusinessView[]> {
    const { rows } = await this.db.query<Row>(
      `SELECT ${COLUMNS} FROM social.business_profiles b WHERE b.owner_user_id = $1 AND b.deleted_at IS NULL ORDER BY b.created_at`,
      [owner.userId, owner.profileId, owner.userId],
    );
    return rows.map(toView);
  }

  async search(raw: unknown, viewer: { userId: string; profileId: string } | null): Promise<BusinessView[]> {
    const f = parse(BusinessSearchQuery, raw);
    const key = f.q.toLowerCase().replace(/^@/, "").replace(/[\\%_]/g, "\\$&");
    const { rows } = await this.db.query<Row>(
      `SELECT ${COLUMNS} FROM social.business_profiles b
        WHERE b.deleted_at IS NULL AND b.moderation_state = 'VISIBLE' AND (lower(b.handle) LIKE $1 || '%' OR lower(b.name) LIKE '%' || $1 || '%')
        ORDER BY (b.verification_status <> 'UNVERIFIED') DESC, lower(b.handle) = $1 DESC, b.name LIMIT $4`,
      [key, viewer?.profileId ?? null, viewer?.userId ?? null, f.limit],
    );
    return rows.map(toView);
  }

  /** Solo administración. INSTITUTIONAL_OFFICIAL se reserva a instituciones oficiales (D-04). */
  async setVerification(handle: string, raw: unknown): Promise<BusinessView> {
    const { verification } = parse(SetBusinessVerificationRequest, raw);
    const { rowCount } = await this.db.query(
      `UPDATE social.business_profiles SET verification_status = $2, updated_at = now() WHERE lower(handle) = lower($1) AND deleted_at IS NULL`,
      [handle, verification],
    );
    if (!rowCount) throw notFound("Negocio");
    return this.view(this.db, handle, null).catch(() => { throw notFound("Negocio"); });
  }

  async idByHandle(q: Queryable, handle: string): Promise<string> {
    const { rows } = await q.query<{ id: string }>(
      `SELECT id FROM social.business_profiles WHERE lower(handle) = lower($1) AND deleted_at IS NULL AND moderation_state = 'VISIBLE'`, [handle],
    );
    if (!rows[0]) throw notFound("Negocio");
    return rows[0].id;
  }

  /**
   * El negocio existe y lo administra esta persona; si no, 404 (no se revela si existe). Para publicar, además
   * no puede estar retirado por moderación.
   */
  async ownedId(q: Queryable, userId: string, handle: string, opts: { toPublish?: boolean } = {}): Promise<string> {
    const { rows } = await q.query<{ id: string; moderation_state: string }>(
      `SELECT id, moderation_state FROM social.business_profiles WHERE lower(handle) = lower($1) AND owner_user_id = $2 AND deleted_at IS NULL`,
      [handle, userId],
    );
    if (!rows[0]) throw notFound("Negocio");
    if (opts.toPublish && rows[0].moderation_state !== "VISIBLE") throw new DomainError("BUSINESS_REMOVED", "Moderación retiró este negocio: no puede publicar", 403);
    return rows[0].id;
  }

  /** Datos mínimos para las declaraciones oficiales (ADR 0095). Incluye negocios retirados por moderación. */
  async officialInfo(q: Queryable, handle: string): Promise<{ id: string; name: string; ownerUserId: string; verification: BusinessVerification; visible: boolean } | null> {
    const { rows } = await q.query<{ id: string; name: string; owner_user_id: string; verification_status: BusinessVerification; moderation_state: string }>(
      `SELECT id, name, owner_user_id, verification_status, moderation_state FROM social.business_profiles WHERE lower(handle) = lower($1) AND deleted_at IS NULL`,
      [handle],
    );
    const r = rows[0];
    return r ? { id: r.id, name: r.name, ownerUserId: r.owner_user_id, verification: r.verification_status, visible: r.moderation_state === "VISIBLE" } : null;
  }

  /** Ids de los negocios de una persona, también los borrados (para retirar sus fuentes institucionales). */
  async idsOwnedBy(q: Queryable, userId: string): Promise<string[]> {
    const { rows } = await q.query<{ id: string }>(`SELECT id FROM social.business_profiles WHERE owner_user_id = $1`, [userId]);
    return rows.map((r) => r.id);
  }

  async namesByIds(q: Queryable, ids: string[]): Promise<Map<string, { handle: string; name: string }>> {
    if (ids.length === 0) return new Map();
    const { rows } = await q.query<{ id: string; handle: string; name: string }>(
      `SELECT id, handle, name FROM social.business_profiles WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`, [ids],
    );
    return new Map(rows.map((r) => [r.id, { handle: r.handle, name: r.name }]));
  }
}

function toView(r: Row): BusinessView {
  return {
    handle: r.handle, name: r.name, category: r.category, country: r.country, description: r.description, addressPublic: r.address_public,
    contactPhone: r.contact_phone, contactUrl: r.contact_url, verification: r.verification_status, logoUrl: r.logo_url, followerCount: r.followers,
    postCount: r.posts, followedByMe: r.followed, blockedByMe: r.blocked === true, isMine: r.mine === true, createdAt: r.created_at.toISOString(),
  };
}

function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const r = schema.safeParse(value);
  if (!r.success) throw new DomainError("VALIDATION", r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data;
}
