import { createHash } from "node:crypto";
import {
  PresenceReviewRequest,
  SubmitReportRequest,
  type MyReportView,
  type PresenceAccessEntry,
  type PresenceReview,
  type PresenceRejectionReason,
  type ReportAssertion,
  type SubmitReportResponse,
} from "@dizaster/contracts";
import { H3_RES, computePresence, extractKeywords, generalize, h3, textFingerprint } from "@dizaster/geo-kit";
import type { Clock } from "../../platform/clock.js";
import type { Db, Queryable } from "../../platform/db.js";
import { withTransaction } from "../../platform/db.js";
import { DomainError, notFound } from "../../platform/errors.js";
import { newId } from "../../platform/ids.js";
import { publish, type OutboxDispatcher } from "../../platform/outbox.js";
import type { EventService } from "../event/index.js";
import type { GeoService } from "../geo/index.js";
import type { AttestationVerifier, IdentityService, Session } from "../identity/index.js";
import type { MediaService } from "../media/index.js";
import type { ReferenceData } from "../reference/index.js";
import type { SocialService } from "../social/index.js";
import type { TrustService } from "../trust/index.js";
import type { FieldCipher } from "../../platform/field-cipher.js";

export interface ReportDeps {
  db: Db;
  clock: Clock;
  ref: ReferenceData;
  geo: GeoService;
  social: SocialService;
  events: EventService;
  identity: IdentityService;
  media: MediaService;
  trust: TrustService;
  attestation: AttestationVerifier;
  limits: { reportsPerHour: number; presenceRetentionDays: number };
  /** Cifra el fix preciso del dispositivo (ADR 0048). */
  cipher: FieldCipher;
}

/**
 * Report Engine: recibe la afirmación ciudadana, valida presencia física (en el servidor),
 * crea su cara social (POST) y entrega el candidato al Event Engine. La evidencia de presencia es privada.
 */
export class ReportService {
  constructor(private readonly d: ReportDeps) {}

  async submit(session: Session, body: unknown): Promise<SubmitReportResponse> {
    const parsed = SubmitReportRequest.safeParse(body);
    if (!parsed.success) throw new DomainError("INVALID_REPORT", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const req = parsed.data;
    const { db, clock, ref, geo } = this.d;

    // Reintento idempotente (cola offline): devuelve la respuesta original.
    const prior = await db.query<{ result: SubmitReportResponse }>(
      `SELECT result FROM report.reports WHERE author_user_id = $1 AND client_report_id = $2`,
      [session.userId, req.clientReportId],
    );
    if (prior.rows[0]) return prior.rows[0].result;

    const country = geo.countryOf(req.pin);
    const category = ref.category(req.categoryCode, country);
    if (!category || !ref.isLeaf(req.categoryCode)) return { outcome: "REJECTED", code: "INVALID_CATEGORY", reason: "Categoría no válida" };
    if (!category.citizenReportable) return { outcome: "REJECTED", code: "OFFICIAL_ONLY", reason: "Esta categoría solo la publican fuentes oficiales o externas" };

    const recent = await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM report.reports WHERE author_user_id = $1 AND received_at > now() - interval '1 hour'`,
      [session.userId],
    );
    // Cuentas nuevas o con mal historial tienen menos cupo (Blueprint §13.3).
    if (Number(recent.rows[0]!.n) >= (await this.d.trust.reportQuota(db, session.userId, this.d.limits.reportsPerHour))) {
      throw new DomainError("RATE_LIMITED", "Demasiados reportes en la última hora", 429);
    }

    const device = req.deviceId ? await this.d.identity.ownedDevice(db, session.userId, req.deviceId) : null;
    if (req.deviceId && !device) throw new DomainError("UNKNOWN_DEVICE", "Dispositivo no registrado para este usuario", 403);
    const attachable = await this.d.media.assertAttachable(db, session.profileId, req.mediaIds);
    const mediaProofs = await this.d.media.inAppCaptures(db, session.profileId, req.mediaIds);

    const receivedAt = clock.now();
    const attestation = await this.d.attestation.verify(req.presence.attestationToken, device?.platform ?? null);
    const presence = computePresence({
      pin: req.pin,
      signals: req.presence,
      category,
      capturedAt: new Date(req.capturedAt),
      capturedOffline: req.capturedOffline,
      receivedAt,
      attestation,
      mediaProofs,
    });
    const anonymity = category.forcePseudonymous ? "PSEUDONYMOUS" : req.anonymityMode;

    return withTransaction(db, async (tx) => {
      const reportId = newId();
      let result: SubmitReportResponse;
      let eventId: string | null = null;
      let downgradeReasons: PresenceRejectionReason[] | null = presence.band === "LOW" ? presence.reasons : null;

      if (!downgradeReasons) {
        const resolution = await this.d.events.resolveCandidate(tx, {
          origin: "CITIZEN_REPORT",
          originRef: { kind: "REPORT", id: reportId },
          categoryCode: req.categoryCode,
          point: req.pin,
          locationUncertaintyM: req.presence.fix.accuracyM,
          occurredAt: req.capturedAt,
          observedAt: req.capturedAt,
          trustTier: "CITIZEN",
          weight: presence.score,
          // El teléfono, no la cuenta: dos cuentas en el mismo teléfono corroboran como una (ADR 0068).
          contributor: { userId: session.userId, deviceId: device?.phoneId ?? null },
          ...(req.targetEventId ? { userSelectedEventId: req.targetEventId } : {}),
          // Un testimonio tardío (offline fuera de tolerancia) solo puede sumarse a un evento existente.
          mayCreateEvent: req.assertion === "OCCURRING" && !presence.lateOffline,
          createAsPending: presence.band === "MEDIUM",
          externalIds: [],
          mediaHashes: (await this.d.media.phashes(tx, attachable.map((m) => m.id))).slice(0, 8),
          metadata: { assertion: req.assertion, presenceBand: presence.band, keywords: extractKeywords(req.text), textHash: textHash(req.text) },
        });
        if (resolution.kind === "INVALID_TARGET") throw new DomainError("INVALID_TARGET", resolution.reason, 422);
        if (resolution.kind === "NO_MATCH") downgradeReasons = presence.lateOffline ? ["LATE_OFFLINE_SUBMISSION"] : presence.reasons;
        else eventId = resolution.eventId;
      }

      // La ubicación pública del post es la del lugar generalizada según la categoría, nunca la del reportero.
      const postId = await this.d.social.createPost(tx, {
        authorProfileId: session.profileId,
        kind: eventId ? "REPORT" : "STANDARD",
        text: req.text ?? null,
        authorVisibility: anonymity,
        categoryCode: req.categoryCode,
        publicPoint: eventId ? generalize(req.pin, category.sensitivity).point : null,
      });
      await this.d.social.attachMedia(tx, postId, attachable);
      if (attachable.length > 0 && category.sensitivity !== "NORMAL") await publish(tx, "PostMediaNeedsReview", { postId });
      await this.d.social.indexPostText(tx, postId, session.profileId, req.text ?? null);
      // Si alguna foto ya se sabe reciclada, moderación la revisa (si se procesa después, avisa el Media Engine).
      for (const mediaId of await this.d.media.reuseSuspected(tx, attachable.map((m) => m.id))) {
        await publish(tx, "MediaReuseDetected", { mediaId });
      }
      if (eventId) {
        await this.d.social.linkPostToEvent(tx, postId, eventId, "REPORT");
        if (req.mediaIds.length > 0) {
          await this.d.events.addTimeline(tx, eventId, "MEDIA_ADDED", { mediaIds: req.mediaIds, mediaCount: req.mediaIds.length, reportId });
        }
        const created = await this.d.events.wasCreatedBy(tx, eventId, reportId);
        result = { outcome: created ? "CREATED_EVENT" : "ATTACHED_TO_EVENT", reportId, postId, eventId, presenceBand: presence.band };
      } else {
        result = { outcome: "DOWNGRADED_TO_POST", postId, reasons: downgradeReasons ?? [] };
      }

      const downgraded = result.outcome === "DOWNGRADED_TO_POST";
      await tx.query(
        `INSERT INTO report.reports
           (id, client_report_id, author_user_id, author_profile_id, device_id, post_id, event_id, category_code, assertion,
            pin, pin_h3_r9, captured_at, received_at, captured_offline, presence_score, presence_band, status, anonymity_mode, result)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, ST_SetSRID(ST_MakePoint($10,$11),4326)::geography, $12,$13,$14,$15,$16,$17,$18,$19,$20)`,
        [
          reportId, req.clientReportId, session.userId, session.profileId, device?.id ?? null, postId, eventId, req.categoryCode, req.assertion,
          req.pin.lng, req.pin.lat, h3(req.pin, H3_RES.DEDUP), req.capturedAt, receivedAt, req.capturedOffline, presence.score, presence.band,
          downgraded ? "DOWNGRADED" : "ACCEPTED", anonymity, JSON.stringify(result),
        ],
      );
      await this.storePresenceEvidence(tx, reportId, req, presence, attestation, receivedAt);
      if (downgraded) {
        await publish(tx, "ReportDowngradedToPost", { postId, reasons: result.outcome === "DOWNGRADED_TO_POST" ? result.reasons : [] });
      }
      await publish(tx, "ReportSubmitted", { reportId, eventId, presenceBand: presence.band, assertion: req.assertion }, { lane: "interactive" });
      return result;
    });
  }

  private async storePresenceEvidence(
    tx: Queryable,
    reportId: string,
    req: SubmitReportRequest,
    presence: ReturnType<typeof computePresence>,
    attestation: string,
    receivedAt: Date,
  ): Promise<void> {
    const fixPoint = { lat: req.presence.fix.lat, lng: req.presence.fix.lng };
    await tx.query(
      `INSERT INTO report.presence_evidence
         (report_id, device_fix_enc, fix_h3_r7, fix_to_pin_m, mock_location, attestation_verdict, reasons, score_breakdown, rule_version, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz + make_interval(days => $11))`,
      [
        reportId, this.d.cipher.encrypt(JSON.stringify(req.presence.fix), reportId), h3(fixPoint, H3_RES.ZONE), presence.fixToPinM, req.presence.mockLocation, attestation,
        presence.reasons, JSON.stringify(presence.breakdown), presence.ruleVersion, receivedAt, this.d.limits.presenceRetentionDays,
      ],
    );
  }

  /**
   * Retención de privacidad: tras el plazo aprobado (30 días por defecto) se borra el fix preciso del dispositivo
   * y solo queda la celda H3 r7 (~5 km²) para estadística y antiabuso. Idempotente; lo ejecuta el worker a diario.
   */
  /**
   * Borrado de cuenta (ADR 0021): la evidencia de presencia se generaliza en el acto, sin esperar la retención,
   * y se desvincula el dispositivo. El reporte sigue contando como evidencia anónima del EVENT.
   */
  registerHandlers(dispatcher: OutboxDispatcher): void {
    dispatcher.on("AccountDeleted", "report.generalize-account", async (e, tx) => {
      await tx.query(
        `UPDATE report.presence_evidence SET device_fix = NULL, device_fix_enc = NULL, generalized_at = COALESCE(generalized_at, now())
          WHERE report_id IN (SELECT id FROM report.reports WHERE author_user_id = $1)`,
        [e.payload.userId],
      );
      await tx.query(`UPDATE report.reports SET device_id = NULL WHERE author_user_id = $1`, [e.payload.userId]);
    });
    // Fusión y división de eventos (ADR 0034): cada reporte apunta al evento donde está su evidencia.
    dispatcher.on("EventMerged", "report.follow-merge", async (e, tx) => {
      await tx.query(`UPDATE report.reports SET event_id = $1 WHERE event_id = $2`, [e.payload.targetEventId, e.payload.mergedEventId]);
    });
    dispatcher.on("EventMergeReverted", "report.follow-merge-revert", async (e, tx) => {
      await tx.query(`UPDATE report.reports SET event_id = $1 WHERE id = ANY($2) AND event_id = $3`, [
        e.payload.restoredEventId, e.payload.evidenceRefIds, e.payload.targetEventId,
      ]);
    });
    dispatcher.on("EventSplit", "report.follow-split", async (e, tx) => {
      const { rows } = await tx.query<{ post_id: string }>(
        `UPDATE report.reports SET event_id = $1 WHERE id = ANY($2) AND event_id = $3 RETURNING post_id`,
        [e.payload.newEventId, e.payload.evidenceRefIds, e.payload.sourceEventId],
      );
      await this.d.social.relinkPosts(tx, rows.map((r) => r.post_id), e.payload.sourceEventId, e.payload.newEventId);
    });
  }

  /**
   * Evidencia de presencia para moderación (ADR 0089, Blueprint §13.1): solo con motivo, y cada consulta queda en un
   * registro de solo inserción. Máximo PRESENCE_ACCESS_PER_HOUR por persona (evita consultas masivas). La ubicación
   * precisa solo existe mientras no se haya generalizado.
   */
  async presenceForReview(postId: string, actorUserId: string, raw: unknown): Promise<PresenceReview> {
    const parsed = PresenceReviewRequest.safeParse(raw);
    if (!parsed.success) throw new DomainError("VALIDATION", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const req = parsed.data;
    return withTransaction(this.d.db, async (tx) => {
      const reportId = await this.reportIdForPost(tx, postId);
      if (!reportId) throw notFound("Reporte");
      // Serializa las consultas de una misma persona para que el límite no se pueda saltar en paralelo.
      await tx.query(`SELECT pg_advisory_xact_lock(hashtext('presence-access:' || $1))`, [actorUserId]);
      const recent = (await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM report.presence_access_log WHERE actor_user_id = $1 AND accessed_at > now() - interval '1 hour'`,
        [actorUserId],
      )).rows[0]!.n;
      if (recent >= PRESENCE_ACCESS_PER_HOUR) throw new DomainError("RATE_LIMITED", "Demasiadas consultas de presencia en una hora", 429);
      const { rows } = await tx.query<{
        presence_band: string; presence_score: number; fix_to_pin_m: number; mock_location: boolean | null; attestation_verdict: PresenceReview["attestationVerdict"];
        reasons: string[]; score_breakdown: Record<string, unknown>; rule_version: string; device_fix: PresenceReview["deviceFix"]; device_fix_enc: string | null;
        expires_at: Date; generalized_at: Date | null; prior: number;
      }>(
        `SELECT r.presence_band, r.presence_score, p.fix_to_pin_m, p.mock_location, p.attestation_verdict, p.reasons, p.score_breakdown,
                p.rule_version, p.device_fix, p.device_fix_enc, p.expires_at, p.generalized_at,
                (SELECT count(*)::int FROM report.presence_access_log l WHERE l.report_id = r.id) AS prior
           FROM report.reports r JOIN report.presence_evidence p ON p.report_id = r.id WHERE r.id = $1`,
        [reportId],
      );
      const r = rows[0];
      if (!r) throw notFound("Evidencia de presencia");
      const deviceFix = r.generalized_at ? null : r.device_fix_enc ? JSON.parse(this.d.cipher.decrypt(r.device_fix_enc, reportId)) : r.device_fix;
      await tx.query(
        `INSERT INTO report.presence_access_log (id, report_id, actor_user_id, reason, case_id, precise_shown) VALUES ($1, $2, $3, $4, $5, $6)`,
        [newId(), reportId, actorUserId, req.reason, req.caseId ?? null, deviceFix !== null],
      );
      return {
        reportId, presenceBand: r.presence_band, presenceScore: r.presence_score, fixToPinM: r.fix_to_pin_m, mockLocation: r.mock_location,
        attestationVerdict: r.attestation_verdict, reasons: r.reasons, scoreBreakdown: r.score_breakdown, ruleVersion: r.rule_version, deviceFix,
        preciseExpiresAt: r.expires_at.toISOString(), generalizedAt: r.generalized_at?.toISOString() ?? null, priorAccesses: r.prior,
      };
    });
  }

  /** Registro de accesos para administración (quién consultó qué y por qué), más reciente primero. */
  async presenceAccessLog(q: Queryable, filter: { reportId?: string; actorUserId?: string; limit: number }): Promise<PresenceAccessEntry[]> {
    const { rows } = await q.query<{ id: string; report_id: string; actor_user_id: string; reason: string; case_id: string | null; precise_shown: boolean; accessed_at: Date }>(
      `SELECT id, report_id, actor_user_id, reason, case_id, precise_shown, accessed_at FROM report.presence_access_log
        WHERE ($1::uuid IS NULL OR report_id = $1) AND ($2::uuid IS NULL OR actor_user_id = $2)
        ORDER BY accessed_at DESC, id DESC LIMIT $3`,
      [filter.reportId ?? null, filter.actorUserId ?? null, filter.limit],
    );
    return rows.map((r) => ({
      id: r.id, reportId: r.report_id, actorUserId: r.actor_user_id, reason: r.reason, caseId: r.case_id, preciseShown: r.precise_shown,
      accessedAt: r.accessed_at.toISOString(),
    }));
  }

  /** Post de un reporte (para que "borrar" un post propio de tipo REPORT lo retire). */
  async reportIdForPost(q: Queryable, postId: string): Promise<string | null> {
    const { rows } = await q.query<{ id: string }>(`SELECT id FROM report.reports WHERE post_id = $1`, [postId]);
    return rows[0]?.id ?? null;
  }

  /**
   * Retirar un reporte propio (Blueprint §6.1, ADR 0037). Idempotente. La evidencia deja de contar para el evento,
   * el post y su media se borran y la presencia precisa se generaliza en el acto. La reputación conserva lo ya
   * decidido: retirar después de un desmentido no borra ese antecedente.
   */
  async withdraw(session: Session, reportId: string): Promise<void> {
    await withTransaction(this.d.db, async (tx) => {
      const r = (await tx.query<{ status: string; post_id: string; author_profile_id: string }>(
        `SELECT status, post_id, author_profile_id FROM report.reports WHERE id = $1 AND author_user_id = $2 FOR UPDATE`, [reportId, session.userId],
      )).rows[0];
      if (!r) throw notFound("Reporte");
      if (r.status === "WITHDRAWN") return;
      await tx.query(`UPDATE report.reports SET status = 'WITHDRAWN' WHERE id = $1`, [reportId]);
      await tx.query(
        `UPDATE report.presence_evidence SET device_fix = NULL, device_fix_enc = NULL, generalized_at = COALESCE(generalized_at, now()) WHERE report_id = $1`, [reportId],
      );
      const eventId = await this.d.events.detachEvidence(tx, "CITIZEN_REPORT", reportId);
      const { mediaIds } = await this.d.social.deletePost(tx, r.post_id, r.author_profile_id, { withdrawReport: true });
      await this.d.media.purgeMedia(tx, mediaIds);
      await publish(tx, "ReportWithdrawn", { reportId, userId: session.userId, eventId });
    });
  }

  async generalizeExpiredPresence(now: Date = this.d.clock.now()): Promise<number> {
    const res = await this.d.db.query(
      `UPDATE report.presence_evidence SET device_fix = NULL, device_fix_enc = NULL, generalized_at = $1 WHERE expires_at <= $1 AND generalized_at IS NULL`,
      [now],
    );
    return res.rowCount ?? 0;
  }

  /** Filas anteriores al cifrado (ADR 0048): se cifran y se vacía la columna en claro. Idempotente, por lotes. */
  async encryptLegacyFixes(batch = 500): Promise<number> {
    const { rows } = await this.d.db.query<{ report_id: string; device_fix: unknown }>(
      `SELECT report_id, device_fix FROM report.presence_evidence WHERE device_fix IS NOT NULL LIMIT $1`, [batch],
    );
    for (const r of rows) {
      await this.d.db.query(
        `UPDATE report.presence_evidence SET device_fix_enc = $2, device_fix = NULL WHERE report_id = $1 AND device_fix IS NOT NULL`,
        [r.report_id, this.d.cipher.encrypt(JSON.stringify(r.device_fix), r.report_id)],
      );
    }
    return rows.length;
  }

  // ───────────── Mis reportes (ADR 0094) ─────────────

  /** Reportes propios, más recientes primero. NO AI REQUIRED. */
  async myReports(q: Queryable, userId: string, limit = MY_REPORTS_LIMIT): Promise<MyReportView[]> {
    const { rows } = await q.query<{
      id: string; post_id: string; event_id: string | null; category_code: string; assertion: ReportAssertion; status: MyReportView["status"];
      captured_at: Date; received_at: Date; captured_offline: boolean; expires_at: Date | null; generalized_at: Date | null; reviews: number;
    }>(
      `SELECT r.id, r.post_id, r.event_id, r.category_code, r.assertion, r.status, r.captured_at, r.received_at, r.captured_offline,
              p.expires_at, p.generalized_at,
              (SELECT count(*) FROM report.presence_access_log l WHERE l.report_id = r.id)::int AS reviews
         FROM report.reports r LEFT JOIN report.presence_evidence p ON p.report_id = r.id
        WHERE r.author_user_id = $1 ORDER BY r.received_at DESC, r.id DESC LIMIT $2`,
      [userId, limit],
    );
    return rows.map((r) => ({
      id: r.id,
      // El post de un reporte retirado ya no existe.
      postId: r.status === "WITHDRAWN" ? null : r.post_id,
      eventId: r.event_id,
      categoryCode: r.category_code,
      assertion: r.assertion,
      status: r.status,
      capturedAt: r.captured_at.toISOString(),
      receivedAt: r.received_at.toISOString(),
      capturedOffline: r.captured_offline,
      preciseLocationRemovesAt: r.generalized_at || !r.expires_at ? null : r.expires_at.toISOString(),
      preciseLocationRemovedAt: r.generalized_at?.toISOString() ?? null,
      presenceReviews: r.reviews,
    }));
  }

  // ───────────── Exportación de datos personales (ADR 0038) ─────────────

  /**
   * Reportes propios con su pin y, mientras no se haya generalizado, la ubicación precisa del dispositivo: son datos
   * de la persona. No se incluyen el desglose del puntaje ni las razones antiabuso (protegen el sistema).
   */
  async exportData(q: Queryable, userId: string): Promise<Record<string, unknown[]>> {
    const { rows } = await q.query(
      `SELECT r.id, r.post_id, r.event_id, r.category_code, r.assertion, r.status, r.anonymity_mode, r.captured_at, r.received_at,
              r.captured_offline, r.presence_band, ST_Y(r.pin::geometry) AS pin_lat, ST_X(r.pin::geometry) AS pin_lng,
              p.device_fix, p.device_fix_enc, p.generalized_at AS precise_location_removed_at
         FROM report.reports r LEFT JOIN report.presence_evidence p ON p.report_id = r.id
        WHERE r.author_user_id = $1 ORDER BY r.received_at DESC LIMIT 10000`,
      [userId],
    );
    // Transparencia (ADR 0089): cuándo moderación consultó la presencia de sus reportes (sin decir quién).
    const accesses = await q.query(
      `SELECT l.report_id, l.accessed_at, l.precise_shown FROM report.presence_access_log l JOIN report.reports r ON r.id = l.report_id
        WHERE r.author_user_id = $1 ORDER BY l.accessed_at DESC LIMIT 10000`,
      [userId],
    );
    // Se descifra solo para la propia persona; el valor cifrado nunca sale.
    return {
      presenceAccesses: accesses.rows,
      reports: rows.map(({ device_fix_enc, ...r }) => ({
        ...r,
        device_fix: device_fix_enc ? JSON.parse(this.d.cipher.decrypt(device_fix_enc as string, r["id"] as string)) : r["device_fix"],
      })),
    };
  }
}

/** Hash de la huella del texto (ADR 0074): textos iguales entre reportes cuentan como un solo corroborador. */
function textHash(text: string | undefined): string | null {
  const f = textFingerprint(text);
  return f ? createHash("sha256").update(f).digest("hex").slice(0, 32) : null;
}

/** Cuántos reportes muestra "Mis reportes": con 10 por hora como máximo, cubre semanas de uso intenso. */
export const MY_REPORTS_LIMIT = 200;

/** Consultas de evidencia de presencia por persona de moderación y hora (ADR 0089). */
export const PRESENCE_ACCESS_PER_HOUR = 30;
