import {
  SubmitReportRequest,
  type PresenceRejectionReason,
  type SubmitReportResponse,
} from "@dizaster/contracts";
import { H3_RES, computePresence, extractKeywords, generalize, h3 } from "@dizaster/geo-kit";
import type { Clock } from "../../platform/clock.js";
import type { Db, Queryable } from "../../platform/db.js";
import { withTransaction } from "../../platform/db.js";
import { DomainError } from "../../platform/errors.js";
import { newId } from "../../platform/ids.js";
import { publish, type OutboxDispatcher } from "../../platform/outbox.js";
import type { EventService } from "../event/index.js";
import type { GeoService } from "../geo/index.js";
import type { AttestationVerifier, IdentityService, Session } from "../identity/index.js";
import type { MediaService } from "../media/index.js";
import type { ReferenceData } from "../reference/index.js";
import type { SocialService } from "../social/index.js";
import type { TrustService } from "../trust/index.js";

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
    if (!category || !ref.isLeaf(req.categoryCode)) return { outcome: "REJECTED", reason: "Categoría no válida" };
    if (!category.citizenReportable) return { outcome: "REJECTED", reason: "Esta categoría solo la publican fuentes oficiales o externas" };

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
          contributor: { userId: session.userId, deviceId: device?.id ?? null },
          ...(req.targetEventId ? { userSelectedEventId: req.targetEventId } : {}),
          // Un testimonio tardío (offline fuera de tolerancia) solo puede sumarse a un evento existente.
          mayCreateEvent: req.assertion === "OCCURRING" && !presence.lateOffline,
          createAsPending: presence.band === "MEDIUM",
          externalIds: [],
          mediaHashes: (await this.d.media.phashes(tx, attachable.map((m) => m.id))).slice(0, 8),
          metadata: { assertion: req.assertion, presenceBand: presence.band, keywords: extractKeywords(req.text) },
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
      await this.d.social.indexPostText(tx, postId, session.profileId, req.text ?? null);
      // Si alguna foto ya se sabe reciclada, moderación la revisa (si se procesa después, avisa el Media Engine).
      for (const mediaId of await this.d.media.reuseSuspected(tx, attachable.map((m) => m.id))) {
        await publish(tx, "MediaReuseDetected", { mediaId });
      }
      if (eventId) {
        await this.d.social.linkPostToEvent(tx, postId, eventId, "REPORT");
        if (req.mediaIds.length > 0) {
          await this.d.events.addTimeline(tx, eventId, "MEDIA_ADDED", { mediaIds: req.mediaIds, mediaCount: req.mediaIds.length });
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
         (report_id, device_fix, fix_h3_r7, fix_to_pin_m, mock_location, attestation_verdict, reasons, score_breakdown, rule_version, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz + make_interval(days => $11))`,
      [
        reportId, JSON.stringify(req.presence.fix), h3(fixPoint, H3_RES.ZONE), presence.fixToPinM, req.presence.mockLocation, attestation,
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
        `UPDATE report.presence_evidence SET device_fix = NULL, generalized_at = COALESCE(generalized_at, now())
          WHERE report_id IN (SELECT id FROM report.reports WHERE author_user_id = $1)`,
        [e.payload.userId],
      );
      await tx.query(`UPDATE report.reports SET device_id = NULL WHERE author_user_id = $1`, [e.payload.userId]);
    });
  }

  async generalizeExpiredPresence(now: Date = this.d.clock.now()): Promise<number> {
    const res = await this.d.db.query(
      `UPDATE report.presence_evidence SET device_fix = NULL, generalized_at = $1 WHERE expires_at <= $1 AND generalized_at IS NULL`,
      [now],
    );
    return res.rowCount ?? 0;
  }
}
