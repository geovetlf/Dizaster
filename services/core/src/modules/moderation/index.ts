import {
  AppealRequest,
  CaseQueueQuery,
  CreateFlagRequest,
  DecideAppealRequest,
  TakeActionRequest,
  type AppealView,
  type CaseDetail,
  type CaseStatus,
  type CaseSummary,
  type FlagReason,
  type FlagTargetType,
  type ModerationActionType,
  type ModerationActionView,
  type ModerationNotice,
  type ModerationTargetPreview,
} from "@dizaster/contracts";
import { z } from "zod";
import { withTransaction, type Db, type Queryable } from "../../platform/db.js";
import { DomainError, notFound } from "../../platform/errors.js";
import { newId } from "../../platform/ids.js";
import { publish, type OutboxDispatcher } from "../../platform/outbox.js";
import type { EventService } from "../event/index.js";
import type { IdentityService } from "../identity/index.js";
import type { MediaService } from "../media/index.js";
import type { SocialService } from "../social/index.js";
import type { TrustService } from "../trust/index.js";
import type { VerificationService } from "../verification/index.js";

/** Peso de cada motivo en la prioridad: primero lo que puede dañar a una persona. */
export const REASON_WEIGHT: Record<FlagReason, number> = { PRIVACY: 5, VIOLENCE: 5, ILLEGAL: 4, HARASSMENT: 3, FALSE_INFO: 2, SPAM: 1, OTHER: 1 };
/** Personas distintas (con cuentas de más de 24 h) que deben denunciar un post para limitarlo sin esperar revisión. */
export const AUTO_LIMIT_FLAGGERS = 5;
export const FLAGS_PER_HOUR = 20;
/** "Quien denuncia" cuando la señal viene de una regla del sistema (no de una persona). Nunca es un perfil real. */
export const SYSTEM_REPORTER = "00000000-0000-0000-0000-000000000000";
/** Plazo para apelar una acción. */
export const APPEAL_WINDOW_DAYS = 30;

/** Qué acciones admite cada tipo de objeto. */
const ALLOWED: Record<FlagTargetType, ModerationActionType[]> = {
  POST: ["HIDE", "REMOVE", "RESTORE", "LIMIT", "WARN_USER", "SUSPEND_USER", "UNSUSPEND_USER", "DISMISS", "APPROVE_MEDIA", "MARK_GRAPHIC"],
  COMMENT: ["HIDE", "REMOVE", "RESTORE", "WARN_USER", "SUSPEND_USER", "UNSUSPEND_USER", "DISMISS"],
  PROFILE: ["WARN_USER", "SUSPEND_USER", "UNSUSPEND_USER", "DISMISS"],
  // Retirar un negocio lo oculta con todos sus posts; las acciones sobre la cuenta afectan a quien lo administra.
  BUSINESS: ["REMOVE", "RESTORE", "WARN_USER", "SUSPEND_USER", "UNSUSPEND_USER", "DISMISS"],
  EVENT: ["MARK_DISPUTED", "DISMISS"],
};
/** Acciones que cierran el caso (las demás, como avisar, lo dejan abierto). */
const CLOSES: Partial<Record<ModerationActionType, CaseStatus>> = {
  HIDE: "RESOLVED", REMOVE: "RESOLVED", RESTORE: "RESOLVED", SUSPEND_USER: "RESOLVED", MARK_DISPUTED: "RESOLVED", DISMISS: "DISMISSED",
  APPROVE_MEDIA: "RESOLVED",
};
/** Acciones apelables y su inversa si la apelación prospera. */
const INVERSE: Partial<Record<ModerationActionType, ModerationActionType>> = {
  HIDE: "RESTORE", REMOVE: "RESTORE", LIMIT: "RESTORE", SUSPEND_USER: "UNSUSPEND_USER",
};

interface ActionRow {
  id: string; action: ModerationActionType; reason: string; actor: "RULE" | "MODERATOR"; target_type: FlagTargetType; target_id: string; created_at: Date;
}

/**
 * Moderation Layer (Blueprint §5.21): denuncias → casos con prioridad determinista → acciones auditables →
 * apelaciones. Solo toca su propio esquema; aplica las acciones a través de social, identity y verification.
 */
export class ModerationService {
  constructor(
    private readonly db: Db,
    private readonly social: SocialService,
    private readonly identity: IdentityService,
    private readonly events: EventService,
    private readonly verification: VerificationService,
    private readonly trust: TrustService,
    private readonly media: MediaService,
  ) {}

  registerHandlers(dispatcher: OutboxDispatcher): void {
    // Foto casi idéntica a otra anterior de otra persona: se abre (o suma a) un caso para cada post que la usa.
    dispatcher.on("MediaReuseDetected", "moderation.media-reuse", async (e, tx) => {
      for (const postId of await this.social.postsWithMedia(tx, e.payload.mediaId)) {
        await this.systemFlag(tx, "POST", postId, "FALSE_INFO", "Regla: una foto es casi idéntica a otra publicada antes por otra cuenta (posible foto reciclada).");
      }
    });
    // Fotos o video en una categoría sensible: esperan a que una persona los apruebe (y, si hace falta, los marque).
    dispatcher.on("PostMediaNeedsReview", "moderation.sensitive-media", async (e, tx) => {
      await this.systemFlag(tx, "POST", e.payload.postId, "PRIVACY", "Regla: media en una categoría sensible; no se muestra hasta aprobarla (revisar rostros, matrículas e imágenes impactantes).");
    });
    // Mismo texto desde varias cuentas en pocas horas (ADR 0031): cada post entra en la cola, sin ocultarse solo.
    dispatcher.on("DuplicateTextDetected", "moderation.duplicate-text", async (e, tx) => {
      for (const postId of e.payload.postIds) {
        await this.systemFlag(tx, "POST", postId, "SPAM", "Regla: el mismo texto fue publicado por varias cuentas distintas en pocas horas (posible spam coordinado).");
      }
    });
  }

  /** Señal automática: entra en la cola como una denuncia más, pero nunca cuenta para el límite automático. */
  private async systemFlag(tx: Queryable, targetType: FlagTargetType, targetId: string, reason: FlagReason, note: string): Promise<void> {
    await tx.query(
      `INSERT INTO moderation.cases (id, target_type, target_id) VALUES ($1, $2, $3)
       ON CONFLICT (target_type, target_id) WHERE status = 'OPEN' DO NOTHING`,
      [newId(), targetType, targetId],
    );
    const caseId = (await tx.query<{ id: string }>(
      `SELECT id FROM moderation.cases WHERE target_type = $1 AND target_id = $2 AND status = 'OPEN' FOR UPDATE`, [targetType, targetId],
    )).rows[0]!.id;
    const inserted = await tx.query(
      `INSERT INTO moderation.flags (id, case_id, target_type, target_id, reporter_profile_id, reporter_weight, reason, note)
       VALUES ($1, $2, $3, $4, $5, 1, $6, $7) ON CONFLICT (target_type, target_id, reporter_profile_id) DO NOTHING`,
      [newId(), caseId, targetType, targetId, SYSTEM_REPORTER, reason, note],
    );
    if (inserted.rowCount) await this.reprioritize(tx, caseId);
  }

  // ───────────── Denuncias ─────────────

  /** Denunciar. Siempre responde igual (no revela si ya existía un caso ni qué pasará). */
  async flag(reporter: { userId: string; profileId: string }, raw: unknown): Promise<void> {
    const f = parse(CreateFlagRequest, raw);
    await withTransaction(this.db, async (tx) => {
      const targetId = await this.resolveTarget(tx, f.targetType, f.targetId);
      if (f.targetType === "PROFILE" && targetId === reporter.profileId) throw new DomainError("VALIDATION", "No puedes denunciarte");
      const recent = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM moderation.flags WHERE reporter_profile_id = $1 AND created_at > now() - interval '1 hour'`,
        [reporter.profileId],
      );
      if (recent.rows[0]!.n >= FLAGS_PER_HOUR) throw new DomainError("RATE_LIMITED", "Demasiadas denuncias seguidas", 429);
      // Las cuentas nuevas o con mal historial pesan menos: frena campañas de denuncias (ADR 0023).
      const weight = await this.trust.flagWeight(tx, reporter.userId);
      await tx.query(
        `INSERT INTO moderation.cases (id, target_type, target_id) VALUES ($1, $2, $3)
         ON CONFLICT (target_type, target_id) WHERE status = 'OPEN' DO NOTHING`,
        [newId(), f.targetType, targetId],
      );
      const caseId = (await tx.query<{ id: string }>(
        `SELECT id FROM moderation.cases WHERE target_type = $1 AND target_id = $2 AND status = 'OPEN' FOR UPDATE`, [f.targetType, targetId],
      )).rows[0]!.id;
      const inserted = await tx.query(
        `INSERT INTO moderation.flags (id, case_id, target_type, target_id, reporter_profile_id, reporter_weight, reason, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (target_type, target_id, reporter_profile_id) DO NOTHING`,
        [newId(), caseId, f.targetType, targetId, reporter.profileId, weight, f.reason, f.note?.trim() || null],
      );
      if (!inserted.rowCount) return;
      await this.reprioritize(tx, caseId);
      if (f.targetType === "POST") await this.autoLimit(tx, caseId, targetId);
    });
  }

  /** Prioridad = Σ peso del motivo × peso de quien denuncia + alcance (log) + gravedad del evento vinculado. */
  private async reprioritize(tx: Queryable, caseId: string): Promise<void> {
    const c = (await tx.query<{ target_type: FlagTargetType; target_id: string }>(`SELECT target_type, target_id FROM moderation.cases WHERE id = $1`, [caseId])).rows[0]!;
    const flags = await tx.query<{ reason: FlagReason; reporter_weight: number }>(`SELECT reason, reporter_weight FROM moderation.flags WHERE case_id = $1`, [caseId]);
    let priority = flags.rows.reduce((s, f) => s + REASON_WEIGHT[f.reason] * f.reporter_weight, 0);
    if (c.target_type === "POST") {
      const t = await this.social.moderationTarget(tx, "POST", c.target_id);
      if (t) {
        priority += Math.log2(1 + t.reach);
        if (t.eventId) {
          const s = (await this.events.publicStates(tx, [t.eventId])).get(t.eventId);
          if (s && s.severity >= 4) priority += 3;
        }
      }
    } else if (c.target_type === "EVENT") {
      const s = (await this.events.publicStates(tx, [c.target_id])).get(c.target_id);
      if (s) priority += s.severity;
    }
    await tx.query(`UPDATE moderation.cases SET priority = $2, updated_at = now() WHERE id = $1`, [caseId, Math.round(priority * 100) / 100]);
  }

  /** Regla determinista: muchas personas establecidas denunciando lo mismo → se limita (fuera del feed) hasta revisar. */
  private async autoLimit(tx: Queryable, caseId: string, postId: string): Promise<void> {
    const n = (await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM moderation.flags WHERE case_id = $1 AND reporter_weight >= 1 AND reporter_profile_id <> '${SYSTEM_REPORTER}'`, [caseId])).rows[0]!.n;
    if (n < AUTO_LIMIT_FLAGGERS) return;
    const t = await this.social.moderationTarget(tx, "POST", postId);
    if (!t || t.state !== "VISIBLE") return;
    await this.social.setPostModeration(tx, postId, "LIMITED");
    await this.log(tx, { caseId, targetType: "POST", targetId: postId, affectedUserId: t.authorUserId, action: "LIMIT", actor: "RULE", moderatorUserId: null,
      reason: `Limitado automáticamente tras ${n} denuncias de personas distintas, a la espera de revisión.` });
  }

  // ───────────── Cola y casos (rol moderator) ─────────────

  async queue(rawQuery: unknown): Promise<{ cases: CaseSummary[]; nextCursor: string | null }> {
    const f = parse(CaseQueueQuery, rawQuery);
    const params: unknown[] = [f.status, f.limit];
    let cursor = "";
    if (f.cursor) {
      const [p, at, id] = Buffer.from(f.cursor, "base64url").toString().split("|");
      if (!p || !at || !id) throw new DomainError("VALIDATION", "Cursor inválido");
      cursor = `AND (-priority, opened_at, id) > (-$${params.push(Number(p))}::real, $${params.push(at)}::timestamptz, $${params.push(id)}::uuid)`;
    }
    const { rows } = await this.db.query<{ id: string; priority: number; opened_at: Date }>(
      `SELECT id, priority, opened_at FROM moderation.cases WHERE status = $1 ${cursor} ORDER BY priority DESC, opened_at, id LIMIT $2`,
      params,
    );
    const cases = await Promise.all(rows.map((r) => this.summary(this.db, r.id)));
    const last = rows[rows.length - 1];
    return {
      cases,
      nextCursor: rows.length === f.limit && last ? Buffer.from(`${last.priority}|${last.opened_at.toISOString()}|${last.id}`).toString("base64url") : null,
    };
  }

  async caseDetail(caseId: string): Promise<CaseDetail> {
    const base = await this.summary(this.db, caseId);
    const notes = await this.db.query<{ reason: FlagReason; note: string; created_at: Date }>(
      `SELECT reason, note, created_at FROM moderation.flags WHERE case_id = $1 AND note IS NOT NULL ORDER BY created_at DESC LIMIT 50`, [caseId],
    );
    const actions = await this.db.query<ActionRow>(
      `SELECT id, action, reason, actor, target_type, target_id, created_at FROM moderation.actions WHERE case_id = $1 ORDER BY created_at`, [caseId],
    );
    return { ...base, notes: notes.rows.map((n) => ({ reason: n.reason, note: n.note, createdAt: n.created_at.toISOString() })), actions: actions.rows.map(actionView) };
  }

  /** Acción de una persona moderadora sobre el objeto del caso. Motivo obligatorio: la persona afectada lo verá. */
  async act(caseId: string, moderatorUserId: string, raw: unknown): Promise<CaseDetail> {
    const a = parse(TakeActionRequest, raw);
    await withTransaction(this.db, async (tx) => {
      const c = (await tx.query<{ target_type: FlagTargetType; target_id: string; status: CaseStatus }>(
        `SELECT target_type, target_id, status FROM moderation.cases WHERE id = $1 FOR UPDATE`, [caseId],
      )).rows[0];
      if (!c) throw notFound("Caso");
      if (!ALLOWED[c.target_type].includes(a.action)) throw new DomainError("VALIDATION", `${a.action} no aplica a ${c.target_type}`);
      await this.apply(tx, { caseId, targetType: c.target_type, targetId: c.target_id, action: a.action, reason: a.reason, moderatorUserId });
      const closes = CLOSES[a.action];
      if (closes && c.status === "OPEN") {
        await tx.query(`UPDATE moderation.cases SET status = $2, resolved_at = now(), resolved_by = $3, updated_at = now() WHERE id = $1`, [caseId, closes, moderatorUserId]);
      }
    });
    return this.caseDetail(caseId);
  }

  private async apply(
    tx: Queryable,
    p: { caseId: string | null; targetType: FlagTargetType; targetId: string; action: ModerationActionType; reason: string; moderatorUserId: string; reverses?: string },
  ): Promise<void> {
    let affectedUserId: string | null = null;
    if (p.targetType === "EVENT") {
      if (p.action === "MARK_DISPUTED") {
        await this.verification.moderatorSetNegative({ eventId: p.targetId, moderatorUserId: p.moderatorUserId, to: "DISPUTED", reason: p.reason, evidenceRefs: [] });
      }
    } else {
      const t = await this.social.moderationTarget(tx, p.targetType, p.targetId);
      if (!t) throw notFound("Objeto");
      affectedUserId = t.authorUserId;
      if (p.targetType === "POST" && (p.action === "APPROVE_MEDIA" || p.action === "MARK_GRAPHIC")) {
        const mediaIds = await this.social.mediaOfPost(tx, p.targetId);
        if (p.action === "APPROVE_MEDIA") await this.media.approve(tx, mediaIds);
        else await this.media.markGraphic(tx, mediaIds);
      } else if (p.targetType === "POST") {
        const state = ({ HIDE: "HIDDEN", REMOVE: "REMOVED", RESTORE: "VISIBLE", LIMIT: "LIMITED" } as const)[p.action as "HIDE"];
        if (state) await this.social.setPostModeration(tx, p.targetId, state);
      } else if (p.targetType === "BUSINESS") {
        const state = ({ REMOVE: "REMOVED", RESTORE: "VISIBLE" } as const)[p.action as "REMOVE"];
        if (state) await this.social.setBusinessModeration(tx, p.targetId, state);
      } else if (p.targetType === "COMMENT") {
        const state = ({ HIDE: "HIDDEN", REMOVE: "REMOVED", RESTORE: "VISIBLE" } as const)[p.action as "HIDE"];
        if (state) await this.social.setCommentModeration(tx, p.targetId, state);
      }
      if (p.action === "SUSPEND_USER") await this.identity.setUserStatus(tx, t.authorUserId, "SUSPENDED");
      if (p.action === "UNSUSPEND_USER") await this.identity.setUserStatus(tx, t.authorUserId, "ACTIVE");
    }
    await this.log(tx, { caseId: p.caseId, targetType: p.targetType, targetId: p.targetId, affectedUserId, action: p.action, actor: "MODERATOR",
      moderatorUserId: p.moderatorUserId, reason: p.reason, reverses: p.reverses ?? null });
  }

  private async log(
    tx: Queryable,
    p: { caseId: string | null; targetType: FlagTargetType; targetId: string; affectedUserId: string | null; action: ModerationActionType; actor: "RULE" | "MODERATOR"; moderatorUserId: string | null; reason: string; reverses?: string | null },
  ): Promise<void> {
    const id = newId();
    await tx.query(
      `INSERT INTO moderation.actions (id, case_id, target_type, target_id, affected_user_id, action, actor, moderator_user_id, reason, reverses_action_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [id, p.caseId, p.targetType, p.targetId, p.affectedUserId, p.action, p.actor, p.moderatorUserId, p.reason, p.reverses ?? null],
    );
    await publish(tx, "ModerationActionTaken", {
      actionId: id, targetType: p.targetType, targetId: p.targetId, action: p.action, actor: p.actor,
      affectedUserId: p.affectedUserId, reverses: p.reverses ?? null,
    });
  }

  // ───────────── Transparencia y apelaciones ─────────────

  /** Acciones que afectan a mi contenido o a mi cuenta (sin datos de quién denunció). */
  async myNotices(userId: string): Promise<ModerationNotice[]> {
    const { rows } = await this.db.query<ActionRow & { appeal_id: string | null; appeal_status: AppealView["status"] | null; decision_reason: string | null }>(
      `SELECT a.id, a.action, a.reason, a.actor, a.target_type, a.target_id, a.created_at,
              ap.id AS appeal_id, ap.status AS appeal_status, ap.decision_reason
         FROM moderation.actions a LEFT JOIN moderation.appeals ap ON ap.action_id = a.id
        WHERE a.affected_user_id = $1 AND a.action NOT IN ('DISMISS','RESTORE','UNSUSPEND_USER','APPROVE_MEDIA')
        ORDER BY a.created_at DESC LIMIT 50`,
      [userId],
    );
    const cutoff = Date.now() - APPEAL_WINDOW_DAYS * 86_400_000;
    return rows.map((r) => ({
      action: actionView(r),
      appeal: r.appeal_id ? { id: r.appeal_id, status: r.appeal_status!, decisionReason: r.decision_reason } : null,
      canAppeal: !r.appeal_id && !!INVERSE[r.action] && r.created_at.getTime() >= cutoff,
    }));
  }

  async appeal(userId: string, actionId: string, raw: unknown): Promise<ModerationNotice> {
    const { text } = parse(AppealRequest, raw);
    const notice = (await this.myNotices(userId)).find((n) => n.action.id === actionId);
    if (!notice) throw notFound("Acción");
    if (!notice.canAppeal) throw new DomainError("NOT_APPEALABLE", "Esta acción no se puede apelar", 409);
    await this.db.query(`INSERT INTO moderation.appeals (id, action_id, appellant_user_id, text) VALUES ($1, $2, $3, $4)`, [newId(), actionId, userId, text]);
    return (await this.myNotices(userId)).find((n) => n.action.id === actionId)!;
  }

  async appeals(status: "OPEN" | "UPHELD" | "REVERSED" = "OPEN"): Promise<AppealView[]> {
    const { rows } = await this.db.query<ActionRow & { appeal_id: string; appeal_status: AppealView["status"]; text: string; appeal_at: Date }>(
      `SELECT a.id, a.action, a.reason, a.actor, a.target_type, a.target_id, a.created_at,
              ap.id AS appeal_id, ap.status AS appeal_status, ap.text, ap.created_at AS appeal_at
         FROM moderation.appeals ap JOIN moderation.actions a ON a.id = ap.action_id
        WHERE ap.status = $1 ORDER BY ap.created_at LIMIT 50`,
      [status],
    );
    return Promise.all(rows.map(async (r) => ({
      id: r.appeal_id, status: r.appeal_status, text: r.text, createdAt: r.appeal_at.toISOString(), action: actionView(r),
      target: await this.preview(this.db, r.target_type, r.target_id).catch(() => null),
    })));
  }

  /** Decidir una apelación. Revertir aplica la acción inversa (restaurar o reactivar) y queda en el registro. */
  async decideAppeal(appealId: string, moderatorUserId: string, raw: unknown): Promise<AppealView> {
    const d = parse(DecideAppealRequest, raw);
    await withTransaction(this.db, async (tx) => {
      const r = (await tx.query<ActionRow & { case_id: string | null; status: string; moderator_user_id: string | null }>(
        `SELECT a.id, a.action, a.reason, a.actor, a.target_type, a.target_id, a.created_at, a.case_id, a.moderator_user_id, ap.status
           FROM moderation.appeals ap JOIN moderation.actions a ON a.id = ap.action_id WHERE ap.id = $1 FOR UPDATE OF ap`,
        [appealId],
      )).rows[0];
      if (!r) throw notFound("Apelación");
      if (r.status !== "OPEN") throw new DomainError("ALREADY_DECIDED", "La apelación ya se decidió", 409);
      // Imparcialidad: quien tomó la decisión no revisa su propia apelación.
      if (r.moderator_user_id === moderatorUserId) throw new DomainError("CONFLICT_OF_INTEREST", "Otra persona debe revisar esta apelación", 409);
      if (d.decision === "REVERSE") {
        await this.apply(tx, { caseId: r.case_id, targetType: r.target_type, targetId: r.target_id, action: INVERSE[r.action]!, reason: d.reason, moderatorUserId, reverses: r.id });
      }
      await tx.query(
        `UPDATE moderation.appeals SET status = $2, decision_reason = $3, decided_by = $4, decided_at = now() WHERE id = $1`,
        [appealId, d.decision === "REVERSE" ? "REVERSED" : "UPHELD", d.reason, moderatorUserId],
      );
    });
    const status = (await this.db.query<{ status: string }>(`SELECT status FROM moderation.appeals WHERE id = $1`, [appealId])).rows[0]!.status as "UPHELD" | "REVERSED";
    return (await this.appeals(status)).find((a) => a.id === appealId)!;
  }

  // ───────────── Auxiliares ─────────────

  private async resolveTarget(q: Queryable, type: FlagTargetType, raw: string): Promise<string> {
    if (type === "PROFILE") return this.social.profileIdByHandle(q, raw);
    if (type === "BUSINESS") return this.social.businessIdForModeration(q, raw);
    const id = parse(z.uuid(), raw);
    if (type === "EVENT") {
      await this.events.getEvent(q, id);
      return id;
    }
    if (!(await this.social.moderationTarget(q, type, id))) throw notFound(type === "POST" ? "Post" : "Comentario");
    return id;
  }

  private async summary(q: Queryable, caseId: string): Promise<CaseSummary> {
    const c = (await q.query<{ id: string; status: CaseStatus; priority: number; target_type: FlagTargetType; target_id: string; opened_at: Date; updated_at: Date }>(
      `SELECT id, status, priority, target_type, target_id, opened_at, updated_at FROM moderation.cases WHERE id = $1`, [caseId],
    )).rows[0];
    if (!c) throw notFound("Caso");
    const reasons = await q.query<{ reason: FlagReason; n: number }>(`SELECT reason, count(*)::int AS n FROM moderation.flags WHERE case_id = $1 GROUP BY reason`, [caseId]);
    const target = await this.preview(q, c.target_type, c.target_id).catch(() => ({ type: c.target_type, id: c.target_id, text: null, authorHandle: null, state: "DELETED", categoryCode: null }));
    return {
      id: c.id, status: c.status, priority: c.priority, target,
      flagCount: reasons.rows.reduce((s, r) => s + r.n, 0),
      reasons: Object.fromEntries(reasons.rows.map((r) => [r.reason, r.n])),
      openedAt: c.opened_at.toISOString(), updatedAt: c.updated_at.toISOString(),
    };
  }

  private async preview(q: Queryable, type: FlagTargetType, id: string): Promise<ModerationTargetPreview> {
    if (type === "EVENT") {
      const e = await this.events.getEvent(q, id);
      const title = e.title ? (e.title["es"] ?? Object.values(e.title)[0] ?? null) : null;
      return { type, id, text: title, authorHandle: null, state: e.publicVerificationState, categoryCode: e.categoryCode };
    }
    const t = await this.social.moderationTarget(q, type, id);
    if (!t) throw notFound("Objeto");
    const base = { type, id, text: t.text, authorHandle: t.authorHandle, state: t.state, categoryCode: t.categoryCode };
    if (type !== "POST") return base;
    return { ...base, media: await this.media.publicViews(q, await this.social.mediaOfPost(q, id), { requireApproval: false }) };
  }

  // ───────────── Calidad (ADR 0026) ─────────────

  /** Cola de moderación: lo abierto (y lo más antiguo), cuánto tarda resolver y cuántas apelaciones se revierten. */
  async qualityStats(q: Queryable, from: Date, to: Date, now: Date) {
    const open = await q.query<{ n: number; oldest: Date | null }>(
      `SELECT count(*)::int AS n, min(opened_at) AS oldest FROM moderation.cases WHERE status = 'OPEN'`,
    );
    const res = await q.query<{ n: number; med: number | null }>(
      `SELECT count(*)::int AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (resolved_at - opened_at)) / 3600) AS med
         FROM moderation.cases WHERE status <> 'OPEN' AND resolved_at >= $1 AND resolved_at < $2`,
      [from, to],
    );
    const ap = await q.query<{ decided: number; reversed: number }>(
      `SELECT count(*)::int AS decided, count(*) FILTER (WHERE status = 'REVERSED')::int AS reversed
         FROM moderation.appeals WHERE decided_at >= $1 AND decided_at < $2`,
      [from, to],
    );
    const oldest = open.rows[0]!.oldest;
    const h = (v: number | null) => (v === null ? null : Math.round(Number(v) * 10) / 10);
    return {
      openCases: open.rows[0]!.n,
      oldestOpenHours: oldest ? h(Math.max(0, (now.getTime() - oldest.getTime()) / 3_600_000)) : null,
      resolvedCases: res.rows[0]!.n,
      medianResolutionHours: h(res.rows[0]!.med),
      appealsDecided: ap.rows[0]!.decided,
      appealsReversed: ap.rows[0]!.reversed,
    };
  }

  // ───────────── Exportación de datos personales (ADR 0038) ─────────────

  /** Acciones sobre mi contenido o cuenta, mis apelaciones y mis denuncias. Nunca quién me denunció. */
  async exportData(q: Queryable, who: { userId: string; profileId: string }): Promise<Record<string, unknown[]>> {
    const actions = await q.query(
      `SELECT id, target_type, target_id, action, actor, reason, created_at FROM moderation.actions WHERE affected_user_id = $1 ORDER BY created_at DESC LIMIT 5000`, [who.userId],
    );
    const appeals = await q.query(`SELECT id, action_id, text, status, decision_reason, created_at, decided_at FROM moderation.appeals WHERE appellant_user_id = $1`, [who.userId]);
    const flags = await q.query(`SELECT target_type, target_id, reason, note, created_at FROM moderation.flags WHERE reporter_profile_id = $1 ORDER BY created_at DESC LIMIT 5000`, [who.profileId]);
    return { actionsOnMyContent: actions.rows, appeals: appeals.rows, flagsISent: flags.rows };
  }
}

function actionView(r: ActionRow): ModerationActionView {
  return { id: r.id, action: r.action, reason: r.reason, actor: r.actor, targetType: r.target_type, targetId: r.target_id, createdAt: r.created_at.toISOString() };
}

function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const r = schema.safeParse(value);
  if (!r.success) throw new DomainError("VALIDATION", r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data;
}
