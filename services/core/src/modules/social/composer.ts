import { CreatePostRequest, EditPostRequest, SharePostRequest } from "@dizaster/contracts";
import { withTransaction, type Db } from "../../platform/db.js";
import { DomainError, notFound } from "../../platform/errors.js";
import { publish } from "../../platform/outbox.js";
import type { EventService } from "../event/index.js";
import type { MediaService } from "../media/index.js";
import type { BusinessService } from "./business.js";
import type { SocialService } from "./index.js";

/** Publicaciones sin reporte por persona y hora (anti-spam barato; los reportes tienen su propio cupo). */
export const POSTS_PER_HOUR = 20;

/**
 * Publicar sin reporte (D-03, ADR 0027): texto con etiquetas y menciones, fotos o un video, y opcionalmente la
 * mención de un EVENT. Nunca crea ni alimenta pines ni verificación, y no lleva ubicación: solo un REPORT con
 * presencia hace eso.
 */
export class PostComposer {
  constructor(
    private readonly db: Db,
    private readonly social: SocialService,
    private readonly media: MediaService,
    private readonly events: EventService,
    private readonly business: BusinessService,
    /** Cupo por hora según la reputación (ADR 0132); sin él, el fijo. */
    private readonly postsPerHour: (userId: string) => Promise<number> = async () => POSTS_PER_HOUR,
    /** Comprueba sello y ámbito institucional para una actualización oficial (ADR 0153); sin él, nadie puede. */
    private readonly officialUpdateCheck: (userId: string, handle: string, event: { categoryCode: string; countryCode: string | null }) => Promise<void> =
      async () => { throw new DomainError("NOT_INSTITUTIONAL", "Este perfil no puede pronunciarse oficialmente", 403); },
  ) {}

  async create(session: { userId: string; profileId: string }, raw: unknown): Promise<{ postId: string; eventId: string | null; tags: string[]; mentions: string[] }> {
    const { profileId } = session;
    const parsed = CreatePostRequest.safeParse(raw);
    if (!parsed.success) throw new DomainError("VALIDATION", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const req = parsed.data;
    // Publicar como negocio: solo quien lo administra, nunca de forma seudónima. El cupo por hora es de la persona.
    const businessId = await this.publisher(session, req);
    // Reintento idempotente (ADR 0178): el mismo id del cliente devuelve el post ya creado, sin gastar cupo.
    const replay = () => (req.clientId ? this.social.postByClientId(this.db, req.clientId, [businessId ?? profileId]) : Promise.resolve(null));
    const existing = await replay();
    if (existing) return existing;
    await this.checkHourlyQuota(session);
    const media = await this.media.assertAttachable(this.db, profileId, req.mediaIds);
    if (media.filter((m) => m.kind === "VIDEO_RECORDED").length > 1) throw new DomainError("VALIDATION", "Solo un video por publicación");

    // Un EVENT fusionado se menciona por el que lo absorbió; uno oculto o inexistente no se puede mencionar.
    let event: { id: string; categoryCode: string; sensitivity: string } | null = null;
    if (req.eventId) {
      const e = await this.events.getEvent(this.db, req.eventId);
      const target = e.mergedIntoId ? await this.events.getEvent(this.db, e.mergedIntoId) : e;
      if (target.publicationState !== "PUBLISHED") throw notFound("Evento");
      event = { id: target.id, categoryCode: target.categoryCode, sensitivity: target.sensitivity };
      if (req.official && req.asBusiness) await this.officialUpdateCheck(session.userId, req.asBusiness, target);
    }
    // Actualización oficial (ADR 0153): la publica una institución sobre un evento concreto.
    if (req.official && (!req.asBusiness || !event)) throw new DomainError("VALIDATION", "Una actualización oficial se publica como institución y sobre un evento");

    try {
      return await this.insertPost(session, req, businessId, media, event);
    } catch (err) {
      // Dos envíos con el mismo id a la vez: el segundo choca con el índice único y devuelve el primero.
      if ((err as { code?: string; constraint?: string }).constraint === "posts_client_id_uidx") {
        const again = await replay();
        if (again) return again;
      }
      throw err;
    }
  }

  private async insertPost(
    session: { userId: string; profileId: string }, req: CreatePostRequest, businessId: string | null,
    media: Awaited<ReturnType<MediaService["assertAttachable"]>>, event: { id: string; categoryCode: string; sensitivity: string } | null,
  ): Promise<{ postId: string; eventId: string | null; tags: string[]; mentions: string[] }> {
    const { profileId } = session;
    return withTransaction(this.db, async (tx) => {
      const postId = await this.social.createPost(tx, {
        authorProfileId: profileId,
        clientId: req.clientId ?? null,
        kind: req.official ? "OFFICIAL_UPDATE" : "STANDARD",
        text: req.text,
        authorVisibility: req.anonymityMode,
        categoryCode: event?.categoryCode ?? null,
        publicPoint: null,
        businessId,
      });
      await this.social.attachMedia(tx, postId, media);
      if (media.length > 0 && event && event.sensitivity !== "NORMAL") await publish(tx, "PostMediaNeedsReview", { postId });
      for (const mediaId of await this.media.reuseSuspected(tx, media.map((m) => m.id))) await publish(tx, "MediaReuseDetected", { mediaId });
      for (const mediaId of await this.media.heldByBlocklist(tx, media.map((m) => m.id))) await publish(tx, "BlockedMediaMatched", { mediaId });
      if (event) await this.social.linkPostToEvent(tx, postId, event.id, req.official ? "UPDATE" : "MENTION");
      if (event && req.official && req.asBusiness) {
        const institution = await this.business.officialInfo(tx, req.asBusiness);
        await publish(tx, "OfficialUpdatePosted", { postId, eventId: event.id, institutionName: institution?.name ?? req.asBusiness });
      }
      const indexed = await this.social.indexPostText(tx, postId, profileId, req.text);
      return { postId, eventId: event?.id ?? null, ...indexed };
    });
  }

  /**
   * Compartir dentro de la app (ADR 0046): un post SHARE con comentario opcional que apunta al original. Compartir
   * algo compartido comparte el original. No hereda media, evento ni ubicación: no alimenta pines ni verificación.
   */
  async share(session: { userId: string; profileId: string }, originalId: string, raw: unknown): Promise<{ postId: string; sharedPostId: string }> {
    const parsed = SharePostRequest.safeParse(raw);
    if (!parsed.success) throw new DomainError("VALIDATION", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const req = parsed.data;
    await this.checkHourlyQuota(session);
    const businessId = await this.publisher(session, req);
    const original = await this.social.shareTarget(this.db, originalId);
    await this.social.assertCanInteract(this.db, original.id, session.profileId);
    return withTransaction(this.db, async (tx) => {
      const postId = await this.social.createPost(tx, {
        authorProfileId: session.profileId,
        kind: "SHARE",
        text: req.text ? req.text : null,
        authorVisibility: req.anonymityMode,
        categoryCode: original.categoryCode,
        publicPoint: null,
        businessId,
        sharedPostId: original.id,
      });
      if (req.text) await this.social.indexPostText(tx, postId, session.profileId, req.text);
      return { postId, sharedPostId: original.id };
    });
  }

  /** Cupo por hora de la persona (publicaciones y compartidos, incluidos los de sus negocios). */
  private async checkHourlyQuota(session: { userId: string; profileId: string }): Promise<void> {
    const recent = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM social.posts p
        WHERE p.kind IN ('STANDARD','SHARE','OFFICIAL_UPDATE') AND p.created_at > now() - interval '1 hour'
          AND (p.author_id = $1 OR p.author_id IN (SELECT id FROM social.business_profiles WHERE owner_user_id = $2))`,
      [session.profileId, session.userId],
    );
    if (recent.rows[0]!.n >= (await this.postsPerHour(session.userId))) throw new DomainError("RATE_LIMITED", "Demasiadas publicaciones en la última hora", 429);
  }

  /** Publicar como negocio: solo quien lo administra, nunca de forma seudónima. */
  private async publisher(session: { userId: string }, req: { asBusiness?: string | undefined; anonymityMode: "PUBLIC" | "PSEUDONYMOUS" }): Promise<string | null> {
    const businessId = req.asBusiness ? await this.business.ownedId(this.db, session.userId, req.asBusiness, { toPublish: true }) : null;
    if (businessId && req.anonymityMode === "PSEUDONYMOUS") throw new DomainError("VALIDATION", "Un negocio no publica de forma seudónima");
    return businessId;
  }

  /** Editar el texto (ADR 0136). Las reglas viven en `SocialService.editPost`. */
  async edit(profileId: string, postId: string, raw: unknown): Promise<{ postId: string; editedAt: string }> {
    const parsed = EditPostRequest.safeParse(raw);
    if (!parsed.success) throw new DomainError("VALIDATION", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const r = await withTransaction(this.db, (tx) => this.social.editPost(tx, postId, profileId, parsed.data.text));
    return { postId, editedAt: r.editedAt.toISOString() };
  }

  async delete(profileId: string, postId: string): Promise<void> {
    await withTransaction(this.db, async (tx) => {
      const { mediaIds } = await this.social.deletePost(tx, postId, profileId);
      await this.media.purgeMedia(tx, mediaIds);
    });
  }
}
