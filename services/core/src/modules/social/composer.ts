import { CreatePostRequest } from "@dizaster/contracts";
import { withTransaction, type Db } from "../../platform/db.js";
import { DomainError, notFound } from "../../platform/errors.js";
import { publish } from "../../platform/outbox.js";
import type { EventService } from "../event/index.js";
import type { MediaService } from "../media/index.js";
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
  ) {}

  async create(profileId: string, raw: unknown): Promise<{ postId: string; eventId: string | null; tags: string[]; mentions: string[] }> {
    const parsed = CreatePostRequest.safeParse(raw);
    if (!parsed.success) throw new DomainError("VALIDATION", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const req = parsed.data;
    const recent = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM social.posts WHERE author_id = $1 AND kind = 'STANDARD' AND created_at > now() - interval '1 hour'`,
      [profileId],
    );
    if (recent.rows[0]!.n >= POSTS_PER_HOUR) throw new DomainError("RATE_LIMITED", "Demasiadas publicaciones en la última hora", 429);

    const media = await this.media.assertAttachable(this.db, profileId, req.mediaIds);
    if (media.filter((m) => m.kind === "VIDEO_RECORDED").length > 1) throw new DomainError("VALIDATION", "Solo un video por publicación");

    // Un EVENT fusionado se menciona por el que lo absorbió; uno oculto o inexistente no se puede mencionar.
    let event: { id: string; categoryCode: string } | null = null;
    if (req.eventId) {
      const e = await this.events.getEvent(this.db, req.eventId);
      const target = e.mergedIntoId ? await this.events.getEvent(this.db, e.mergedIntoId) : e;
      if (target.publicationState !== "PUBLISHED") throw notFound("Evento");
      event = { id: target.id, categoryCode: target.categoryCode };
    }

    return withTransaction(this.db, async (tx) => {
      const postId = await this.social.createPost(tx, {
        authorProfileId: profileId,
        kind: "STANDARD",
        text: req.text,
        authorVisibility: req.anonymityMode,
        categoryCode: event?.categoryCode ?? null,
        publicPoint: null,
      });
      await this.social.attachMedia(tx, postId, media);
      for (const mediaId of await this.media.reuseSuspected(tx, media.map((m) => m.id))) await publish(tx, "MediaReuseDetected", { mediaId });
      if (event) await this.social.linkPostToEvent(tx, postId, event.id, "MENTION");
      const indexed = await this.social.indexPostText(tx, postId, profileId, req.text);
      return { postId, eventId: event?.id ?? null, ...indexed };
    });
  }

  async delete(profileId: string, postId: string): Promise<void> {
    await withTransaction(this.db, async (tx) => {
      const { mediaIds } = await this.social.deletePost(tx, postId, profileId);
      await this.media.purgeMedia(tx, mediaIds);
    });
  }
}
