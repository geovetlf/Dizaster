import type {
  EventStatus,
  CategoryConfig,
  ContextualLocation,
  NearbyEvent,
  EventCandidate,
  EventMapResponse,
  DuplicateCandidateView,
  EventMergeView,
  EventSummary,
  ModeratorEventDetail,
  GeoPoint,
  NegativeState,
  PublicVerificationState,
  Sensitivity,
  TimelineEntryView,
  TrustTier,
  VerificationLevel,
} from "@dizaster/contracts";
import { AreaGeometry, EventSearchQuery, VERIFICATION_LEVEL_RANK, publicVerificationState } from "@dizaster/contracts";
import {
  DEDUP_RULES,
  H3_RES,
  clusterResolutionForZoom,
  decideDedup,
  categoryCompatibility,
  distanceMeters,
  matchScore,
  weightedMedianPoint,
  type DedupCandidateEvent,
} from "@dizaster/geo-kit";
import type { Db, Queryable } from "../../platform/db.js";
import { withTransaction } from "../../platform/db.js";
import { DomainError, notFound } from "../../platform/errors.js";
import { newId } from "../../platform/ids.js";
import { publish, type OutboxDispatcher } from "../../platform/outbox.js";
import { searchKey, type GeoService } from "../geo/index.js";
import type { ReferenceData } from "../reference/index.js";

export type ResolutionResult =
  | { kind: "CREATED" | "ATTACHED"; eventId: string; evidenceId: string; confidence: MatchConfidence; score: number | null }
  | { kind: "NO_MATCH" }
  | { kind: "INVALID_TARGET"; reason: string };

type MatchConfidence = "EXACT" | "USER_SELECTED" | "AUTO" | "AMBIGUOUS" | "NEW_EVENT";

/** Datos internos de evidencia para el Verification Engine (nunca se exponen públicamente). */
export interface EvidenceForVerification {
  id: string;
  evidenceType: string;
  refId: string;
  trustTier: TrustTier;
  assertion: "OCCURRING" | "NOT_OCCURRING";
  presenceBand: string | null;
  contributorUserId: string | null;
  contributorDeviceId: string | null;
  /** Huella del texto del reporte (ADR 0074); null si no tenía texto o era corto. */
  textHash: string | null;
  observedAt: Date;
}

const EVIDENCE_TYPE_BY_ORIGIN: Record<EventCandidate["origin"], string> = {
  CITIZEN_REPORT: "CITIZEN_REPORT",
  OFFICIAL: "OFFICIAL_ITEM",
  EXTERNAL: "EXTERNAL_ITEM",
  OPEN_DATA: "EXTERNAL_ITEM",
  NEWS: "EXTERNAL_ITEM",
  SENSOR: "SENSOR",
};

interface EventRow {
  id: string; category_code: string; title: Record<string, string> | null; lat: number; lng: number;
  sensitivity: EventSummary["sensitivity"]; country_code: string | null; status: EventSummary["status"];
  severity: number; verification_level: VerificationLevel; negative_state: NegativeState; report_count: number;
  source_count: number; first_seen_at: Date; last_activity_at: Date; publication_state: string; merged_into_id: string | null;
  place: ContextualLocation | null;
}

const PUBLIC_EVENT_COLUMNS = `
  e.id, e.category_code, e.title, ST_Y(e.public_geom::geometry) AS lat, ST_X(e.public_geom::geometry) AS lng,
  e.sensitivity, e.country_code, e.status, e.severity, e.verification_level, e.negative_state,
  e.report_count, e.source_count, e.first_seen_at, e.last_activity_at, e.publication_state, e.merged_into_id, e.place`;

function toSummary(r: EventRow): EventSummary {
  return {
    id: r.id,
    categoryCode: r.category_code,
    title: r.title,
    point: { lat: r.lat, lng: r.lng },
    sensitivity: r.sensitivity,
    countryCode: r.country_code?.trim() ?? null,
    place: r.place ?? null,
    status: r.status,
    severity: r.severity,
    verificationLevel: r.verification_level,
    negativeState: r.negative_state,
    publicVerificationState: publicVerificationState(r.verification_level, r.negative_state),
    reportCount: r.report_count,
    sourceCount: r.source_count,
    firstSeenAt: r.first_seen_at.toISOString(),
    lastActivityAt: r.last_activity_at.toISOString(),
  };
}

/**
 * Event Engine: convierte candidatos de CUALQUIER origen en EVENTs canónicos, deduplica,
 * mantiene la geometría agregada, la timeline y el ciclo de vida.
 * No sabe qué proveedor de mapas se usa ni decide la verificación (eso es del Verification Engine).
 */
export class EventService {
  constructor(
    private readonly ref: ReferenceData,
    private readonly geo: GeoService,
    private readonly opts: { archiveAfterDays: number } = { archiveAfterDays: 7 },
  ) {}

  registerHandlers(dispatcher: OutboxDispatcher): void {
    // Una foto que termina de procesarse después del reporte suma su hash a los eventos donde se publicó.
    dispatcher.on("MediaReady", "event.media-fingerprint", async (e, tx) => {
      if (!e.payload.phash) return;
      const { rows } = await tx.query<{ event_id: string }>(
        `SELECT DISTINCT event_id FROM event.timeline WHERE type = 'MEDIA_ADDED' AND payload->'mediaIds' @> to_jsonb($1::text)`,
        [e.payload.mediaId],
      );
      for (const r of rows) await this.addFingerprint(tx, r.event_id, [], [e.payload.phash]);
    });
    // El nivel de verificación lo decide otro módulo; aquí solo se refleja (copia denormalizada + timeline).
    dispatcher.on("VerificationChanged", "event.mirror-verification", async (e, tx) => {
      await tx.query(`UPDATE event.events SET verification_level = $2, negative_state = $3, updated_at = now() WHERE id = $1`, [
        e.payload.eventId, e.payload.to, e.payload.negativeState,
      ]);
      await this.addTimeline(tx, e.payload.eventId, "VERIFICATION_CHANGED", {
        from: e.payload.from, to: e.payload.to, negativeState: e.payload.negativeState,
      });
    });
  }

  async resolveCandidate(tx: Queryable, c: EventCandidate): Promise<ResolutionResult> {
    const evidenceType = EVIDENCE_TYPE_BY_ORIGIN[c.origin];
    // Idempotencia: la misma pieza de evidencia nunca se procesa dos veces.
    const already = await tx.query<{ id: string; event_id: string; match_confidence: MatchConfidence; match_score: number | null }>(
      `SELECT id, event_id, match_confidence, match_score FROM event.evidence WHERE evidence_type = $1 AND ref_id = $2`,
      [evidenceType, c.originRef.id],
    );
    if (already.rows[0]) {
      const a = already.rows[0];
      return { kind: "ATTACHED", eventId: a.event_id, evidenceId: a.id, confidence: a.match_confidence, score: a.match_score };
    }

    const country = this.geo.countryOf(c.point);
    const category = this.ref.category(c.categoryCode, country);
    if (!category) return { kind: "INVALID_TARGET", reason: "Categoría desconocida o deshabilitada en el país" };

    const isCounter = c.metadata["assertion"] === "NOT_OCCURRING";
    if (c.userSelectedEventId) {
      const target = await this.validateTarget(tx, c, category);
      if (target.ok) return this.attach(tx, target.eventId, c, "USER_SELECTED", null);
      if (isCounter) return { kind: "INVALID_TARGET", reason: target.reason };
    } else if (isCounter && c.trustTier === "CITIZEN") {
      // Un ciudadano solo puede negar un evento concreto que ve; nunca "negar por zona".
      return { kind: "INVALID_TARGET", reason: "Un contra-reporte debe indicar el evento" };
    }

    // Serializa la resolución por zona (~250 km²) para que dos reportes simultáneos no creen dos eventos.
    await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [this.geo.h3(c.point, H3_RES.REGION)]);

    const candidates = await this.findCandidates(tx, c, category);
    const decision = decideDedup(
      {
        categoryCode: c.categoryCode,
        point: c.point,
        observedAt: new Date(c.observedAt),
        keywords: (c.metadata["keywords"] as string[] | undefined) ?? [],
        mediaHashes: c.mediaHashes ?? [],
        dedupRadiusM: category.dedupRadiusM,
        dedupWindowMinutes: category.dedupWindowMinutes,
        compatibleWith: category.compatibleWith,
      },
      candidates,
    );

    if (decision.kind === "ATTACH") return this.attach(tx, decision.eventId, c, "AUTO", decision.score);
    if (decision.kind === "AMBIGUOUS") {
      const best = decision.candidates[0]!;
      const res = await this.attach(tx, best.eventId, c, "AMBIGUOUS", best.score);
      if (res.kind === "ATTACHED") {
        await tx.query(`INSERT INTO event.dedup_reviews (id, evidence_id, candidates) VALUES ($1, $2, $3)`, [
          newId(), res.evidenceId, JSON.stringify(decision.candidates),
        ]);
      }
      return res;
    }
    // Una negación nunca crea eventos.
    if (!c.mayCreateEvent || isCounter) return { kind: "NO_MATCH" };
    return this.create(tx, c, category, country);
  }

  private async validateTarget(tx: Queryable, c: EventCandidate, category: CategoryConfig): Promise<{ ok: true; eventId: string } | { ok: false; reason: string }> {
    const { rows } = await tx.query<{ id: string; category_code: string; lat: number; lng: number; status: string; merged_into_id: string | null }>(
      `SELECT id, category_code, ST_Y(geom::geometry) AS lat, ST_X(geom::geometry) AS lng, status, merged_into_id
         FROM event.events WHERE id = $1 FOR UPDATE`,
      [c.userSelectedEventId],
    );
    const ev = rows[0];
    if (!ev) return { ok: false, reason: "Evento no encontrado" };
    if (ev.merged_into_id) return this.validateTarget(tx, { ...c, userSelectedEventId: ev.merged_into_id }, category);
    if (ev.status !== "ACTIVE" && ev.status !== "MONITORING") return { ok: false, reason: "El evento ya no está activo" };
    if (categoryCompatibility(c.categoryCode, ev.category_code, category.compatibleWith) === 0) {
      return { ok: false, reason: "Categoría incompatible con el evento" };
    }
    const maxDistance = Math.max(category.dedupRadiusM * 1.5, category.presenceRadiusM);
    if (this.geo.distanceMeters(c.point, { lat: ev.lat, lng: ev.lng }) > maxDistance) {
      return { ok: false, reason: "El evento está demasiado lejos del lugar del reporte" };
    }
    return { ok: true, eventId: ev.id };
  }

  private async findCandidates(tx: Queryable, c: EventCandidate, category: CategoryConfig): Promise<DedupCandidateEvent[]> {
    return this.candidateEvents(tx, c.categoryCode, c.point, c.observedAt, category, null);
  }

  private async candidateEvents(
    tx: Queryable, categoryCode: string, point: GeoPoint, observedAt: string | Date, category: CategoryConfig, excludeId: string | null,
  ): Promise<DedupCandidateEvent[]> {
    const root = categoryCode.split(".")[0]!;
    const { rows } = await tx.query<{ id: string; category_code: string; lat: number; lng: number; last_activity_at: Date; keywords: string[]; media_hashes: string[] }>(
      `SELECT id, category_code, ST_Y(geom::geometry) AS lat, ST_X(geom::geometry) AS lng, last_activity_at, keywords, media_hashes
         FROM event.events
        WHERE status IN ('ACTIVE','MONITORING') AND merged_into_id IS NULL AND negative_state <> 'FALSE'
          AND (category_code = ANY($1) OR category_code LIKE $2)
          AND ST_DWithin(geom, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, $5)
          AND last_activity_at >= $6::timestamptz - make_interval(mins => $7)
          AND ($8::uuid IS NULL OR id <> $8)
        LIMIT 50`,
      [
        [categoryCode, ...category.compatibleWith], `${root}.%`, point.lng, point.lat,
        category.dedupRadiusM, observedAt, category.dedupWindowMinutes, excludeId,
      ],
    );
    return rows.map((r) => ({
      id: r.id, categoryCode: r.category_code, point: { lat: r.lat, lng: r.lng }, lastActivityAt: r.last_activity_at,
      keywords: r.keywords, mediaHashes: r.media_hashes,
    }));
  }

  private async create(tx: Queryable, c: EventCandidate, category: CategoryConfig, country: string | null): Promise<ResolutionResult> {
    const id = newId();
    const pub = this.geo.generalize(c.point, category.sensitivity);
    // Ubicación contextual: SIEMPRE desde el punto público generalizado, nunca desde el del reportero.
    const place = await this.geo.contextFor(tx, pub.point, category.sensitivity);
    await tx.query(
      `INSERT INTO event.events
         (id, category_code, title, geom, public_geom, public_h3, h3_r7, h3_r9, sensitivity, uncertainty_m, country_code,
          occurred_start, first_seen_at, last_activity_at, severity, publication_state, region_id, district_id, place)
       VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography,
               $8, $9, $10, $11, $12, $13, $14, $15, $15, $16, $17, $18, $19, $20)`,
      [
        id, c.categoryCode, JSON.stringify(c.title ?? category.names), c.point.lng, c.point.lat, pub.point.lng, pub.point.lat,
        pub.cell, this.geo.h3(c.point, H3_RES.ZONE), this.geo.h3(c.point, H3_RES.DEDUP), category.sensitivity,
        c.locationUncertaintyM, country, c.occurredAt, c.observedAt, c.severityHint ?? category.defaultSeverity,
        c.createAsPending ? "PENDING_CORROBORATION" : "PUBLISHED",
        place?.region?.id ?? null, place?.district?.id ?? null, place ? JSON.stringify(place) : null,
      ],
    );
    await this.addTimeline(tx, id, "CREATED", { origin: c.origin, trustTier: c.trustTier });
    await publish(tx, "EventCreated", { eventId: id, categoryCode: c.categoryCode }, { lane: c.trustTier === "OFFICIAL" ? "urgent" : "interactive" });
    const res = await this.attach(tx, id, c, "NEW_EVENT", null);
    return res.kind === "ATTACHED" ? { ...res, kind: "CREATED" } : res;
  }

  private async attach(tx: Queryable, eventId: string, c: EventCandidate, confidence: MatchConfidence, score: number | null): Promise<ResolutionResult> {
    const evidenceId = newId();
    const evidenceType = EVIDENCE_TYPE_BY_ORIGIN[c.origin];
    const assertion = c.metadata["assertion"] === "NOT_OCCURRING" ? "NOT_OCCURRING" : "OCCURRING";
    await tx.query(
      `INSERT INTO event.evidence
         (id, event_id, evidence_type, ref_id, trust_tier, assertion, point, weight, presence_band,
          contributor_user_id, contributor_device_id, match_score, match_confidence, added_by, observed_at, text_hash)
       VALUES ($1, $2, $3, $4, $5, $6, ST_SetSRID(ST_MakePoint($7, $8), 4326)::geography, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
        evidenceId, eventId, evidenceType, c.originRef.id, c.trustTier, assertion, c.point.lng, c.point.lat, c.weight,
        (c.metadata["presenceBand"] as string | undefined) ?? null, c.contributor?.userId ?? null, c.contributor?.deviceId ?? null,
        score, confidence, confidence === "USER_SELECTED" ? "USER" : "RULE", c.observedAt,
        (c.metadata["textHash"] as string | null | undefined) ?? null,
      ],
    );
    await this.recomputeAggregates(tx, eventId, c);
    if (c.affectedArea && c.trustTier !== "CITIZEN" && assertion === "OCCURRING") await this.addAffectedArea(tx, eventId, c.affectedArea);
    await this.addFingerprint(tx, eventId, (c.metadata["keywords"] as string[] | undefined) ?? [], c.mediaHashes ?? []);
    const timelineType =
      c.trustTier === "OFFICIAL" ? "OFFICIAL_UPDATE" : c.trustTier === "EXTERNAL" ? "SOURCE_ADDED" : assertion === "NOT_OCCURRING" ? "COUNTER_REPORT_ADDED" : "REPORT_ADDED";
    if (confidence !== "NEW_EVENT" || c.trustTier !== "CITIZEN") {
      // Sin identidad del autor: la timeline es pública y debe respetar la publicación seudónima.
      await this.addTimeline(tx, eventId, timelineType, { trustTier: c.trustTier, presenceBand: c.metadata["presenceBand"] ?? null });
    }
    await publish(
      tx,
      "EventEvidenceAdded",
      { eventId, evidenceId, evidenceType },
      { lane: c.trustTier === "OFFICIAL" ? "urgent" : "interactive" },
    );
    return { kind: "ATTACHED", eventId, evidenceId, confidence, score };
  }

  /**
   * Área oficial afectada (ADR 0087): la unión de las áreas que dieron las fuentes externas/oficiales del evento.
   * Se simplifica (~100 m) para que no crezca sin límite.
   */
  private async addAffectedArea(tx: Queryable, eventId: string, area: AreaGeometry): Promise<void> {
    await tx.query(
      `UPDATE event.events SET affected_area = ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SimplifyPreserveTopology(
         ST_Union(coalesce(affected_area::geometry, n.g), n.g), 0.001)), 3))::geography
         FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON($2), 4326) AS g) n
        WHERE id = $1`,
      [eventId, JSON.stringify(area)],
    );
  }

  /**
   * Huella para deduplicar (ADR 0030): palabras clave y hashes de fotos de lo que ya se sabe del evento, acotados
   * (50 y 20) para que el costo no crezca con el tamaño del evento.
   */
  private async addFingerprint(tx: Queryable, eventId: string, keywords: string[], hashes: string[]): Promise<void> {
    if (keywords.length === 0 && hashes.length === 0) return;
    await tx.query(
      `UPDATE event.events SET
         keywords = (SELECT coalesce(array_agg(k), '{}') FROM (SELECT DISTINCT unnest(keywords || $2::text[]) AS k LIMIT 50) x),
         media_hashes = (SELECT coalesce(array_agg(h), '{}') FROM (SELECT DISTINCT unnest(media_hashes || $3::text[]) AS h LIMIT 20) y)
       WHERE id = $1`,
      [eventId, keywords, hashes],
    );
  }

  /** Geometría y contadores agregados. Una fuente oficial prevalece; si no, mediana ponderada (robusta a pines atípicos). */
  private async recomputeAggregates(tx: Queryable, eventId: string, c: Pick<EventCandidate, "observedAt" | "severityHint">): Promise<void> {
    const { rows } = await tx.query<{ lat: number; lng: number; weight: number; trust_tier: TrustTier; contributor_user_id: string | null; observed_at: Date }>(
      `SELECT ST_Y(point::geometry) AS lat, ST_X(point::geometry) AS lng, weight, trust_tier, contributor_user_id, observed_at
         FROM event.evidence WHERE event_id = $1 AND status = 'ACTIVE' AND assertion = 'OCCURRING'`,
      [eventId],
    );
    const ev = (await tx.query<{ sensitivity: EventSummary["sensitivity"]; publication_state: string }>(
      `SELECT sensitivity, publication_state FROM event.events WHERE id = $1`, [eventId],
    )).rows[0];
    if (!ev || rows.length === 0) {
      await tx.query(
        `UPDATE event.events SET last_activity_at = greatest(last_activity_at, $2), report_count = 0, source_count = 0, updated_at = now() WHERE id = $1`,
        [eventId, c.observedAt],
      );
      return;
    }
    const official = rows.filter((r) => r.trust_tier === "OFFICIAL").sort((a, b) => b.observed_at.getTime() - a.observed_at.getTime())[0];
    const point: GeoPoint = official
      ? { lat: official.lat, lng: official.lng }
      : weightedMedianPoint(rows.map((r) => ({ point: { lat: r.lat, lng: r.lng }, weight: r.weight })));
    const pub = this.geo.generalize(point, ev.sensitivity);
    const place = await this.geo.contextFor(tx, pub.point, ev.sensitivity);
    const citizens = rows.filter((r) => r.trust_tier === "CITIZEN");
    const distinctContributors = new Set(citizens.map((r) => r.contributor_user_id)).size;
    const hasNonCitizen = rows.some((r) => r.trust_tier !== "CITIZEN");
    const publication = ev.publication_state === "PENDING_CORROBORATION" && (distinctContributors >= 2 || hasNonCitizen) ? "PUBLISHED" : ev.publication_state;
    await tx.query(
      `UPDATE event.events SET
          geom = ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
          public_geom = ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography,
          public_h3 = $6, h3_r7 = $7, h3_r9 = $8,
          report_count = $9, source_count = $10,
          severity = greatest(severity, $11), last_activity_at = greatest(last_activity_at, $12),
          publication_state = $13, region_id = $14, district_id = $15, place = $16, updated_at = now()
        WHERE id = $1`,
      [
        eventId, point.lng, point.lat, pub.point.lng, pub.point.lat, pub.cell, this.geo.h3(point, H3_RES.ZONE), this.geo.h3(point, H3_RES.DEDUP),
        citizens.length, rows.length - citizens.length, c.severityHint ?? 1, c.observedAt, publication,
        place?.region?.id ?? null, place?.district?.id ?? null, place ? JSON.stringify(place) : null,
      ],
    );
  }

  /**
   * Retiro de un reporte (ADR 0037): su evidencia queda DETACHED (se conserva para auditoría pero deja de contar),
   * se recalculan geometría y contadores, y los consumidores reevalúan como con cualquier cambio de evidencia.
   */
  async detachEvidence(tx: Queryable, evidenceType: "CITIZEN_REPORT", refId: string): Promise<string | null> {
    const { rows } = await tx.query<{ id: string; event_id: string }>(
      `UPDATE event.evidence SET status = 'DETACHED' WHERE evidence_type = $1 AND ref_id = $2 AND status = 'ACTIVE' RETURNING id, event_id`,
      [evidenceType, refId],
    );
    const r = rows[0];
    if (!r) return null;
    await this.recomputeAggregates(tx, r.event_id, { observedAt: new Date(0).toISOString() });
    // Un evento que se queda sin ninguna evidencia deja de mostrarse (su único reporte se retiró).
    await tx.query(
      `UPDATE event.events SET publication_state = 'HIDDEN', updated_at = now()
        WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM event.evidence WHERE event_id = $1 AND status = 'ACTIVE')`,
      [r.event_id],
    );
    await this.addTimeline(tx, r.event_id, "REPORT_WITHDRAWN", {});
    await publish(tx, "EventEvidenceAdded", { eventId: r.event_id, evidenceId: r.id, evidenceType: "WITHDRAWN" });
    return r.event_id;
  }

  // ───────────── Fusión automática y cola de posibles duplicados (ADR 0076) ─────────────

  /**
   * Barrido periódico de EVENTs duplicados que la resolución en línea no evitó (el pin medio se movió, llegaron por
   * fuentes distintas, reportes casi simultáneos en zonas vecinas). Mismas reglas que al adjuntar un reporte
   * (`decideDedup`, dedup-2): con un único candidato claro se fusiona sola, con actor `RULE:auto-merge` y reversible;
   * en la franja ambigua, o si ambos tienen fuentes externas u oficiales, el par va a la cola de moderación.
   * Un par que moderación separó (fusión revertida) o descartó nunca se vuelve a proponer. NO AI REQUIRED.
   */
  async sweepDuplicates(db: Db, now: Date): Promise<{ merged: number; queued: number }> {
    const { rows } = await db.query<{
      id: string; category_code: string; country_code: string | null; lat: number; lng: number; last_activity_at: Date;
      keywords: string[]; media_hashes: string[]; verification_level: VerificationLevel; first_seen_at: Date; sourced: boolean;
    }>(
      `SELECT e.id, e.category_code, e.country_code, ST_Y(e.geom::geometry) AS lat, ST_X(e.geom::geometry) AS lng, e.last_activity_at,
              e.keywords, e.media_hashes, e.verification_level, e.first_seen_at,
              EXISTS (SELECT 1 FROM event.evidence v WHERE v.event_id = e.id AND v.status = 'ACTIVE' AND v.trust_tier <> 'CITIZEN') AS sourced
         FROM event.events e
        WHERE e.status IN ('ACTIVE','MONITORING') AND e.merged_into_id IS NULL AND e.negative_state <> 'FALSE'
          AND e.last_activity_at >= $1::timestamptz - make_interval(hours => $2)
        ORDER BY e.first_seen_at DESC LIMIT $3`,
      [now, AUTO_MERGE.lookbackHours, AUTO_MERGE.maxEventsPerRun],
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    const gone = new Set<string>();
    let merged = 0, queued = 0;
    for (const e of rows) {
      if (gone.has(e.id)) continue;
      const category = this.ref.category(e.category_code, e.country_code?.trim() ?? null);
      if (!category) continue;
      const point = { lat: e.lat, lng: e.lng };
      const all = (await this.candidateEvents(db, e.category_code, point, e.last_activity_at, category, e.id)).filter((c) => !gone.has(c.id));
      const blocked = await this.blockedPairs(db, e.id, all.map((c) => c.id));
      const candidates = all.filter((c) => !blocked.has(c.id));
      const decision = decideDedup(
        {
          categoryCode: e.category_code, point, observedAt: e.last_activity_at, keywords: e.keywords, mediaHashes: e.media_hashes,
          dedupRadiusM: category.dedupRadiusM, dedupWindowMinutes: category.dedupWindowMinutes, compatibleWith: category.compatibleWith,
        },
        candidates,
      );
      if (decision.kind === "NEW") continue;
      if (decision.kind === "AMBIGUOUS") {
        for (const c of decision.candidates.slice(0, 3)) queued += await this.queueDuplicate(db, e.id, c.eventId, c.score, "AMBIGUOUS_SCORE");
        continue;
      }
      const other = byId.get(decision.eventId) ?? (await this.sweepRow(db, decision.eventId));
      if (!other) continue;
      if (e.sourced && other.sourced) {
        // Dos ítems distintos de fuentes externas u oficiales: la fuente los considera distintos; decide una persona.
        queued += await this.queueDuplicate(db, e.id, other.id, decision.score, "BOTH_SOURCED");
        continue;
      }
      const [target, source] = mergeOrder(e, other);
      try {
        await withTransaction(db, (tx) => this.merge(tx, target.id, source.id, AUTO_MERGE.actor, `${DEDUP_RULES.version} score ${decision.score}`, decision.score));
        gone.add(source.id);
        merged++;
      } catch (err) {
        if (!(err instanceof DomainError)) throw err; // ya fusionado por otra vía: se ignora
      }
    }
    return { merged, queued };
  }

  private async sweepRow(q: Queryable, id: string) {
    const { rows } = await q.query<{ id: string; verification_level: VerificationLevel; first_seen_at: Date; sourced: boolean }>(
      `SELECT e.id, e.verification_level, e.first_seen_at,
              EXISTS (SELECT 1 FROM event.evidence v WHERE v.event_id = e.id AND v.status = 'ACTIVE' AND v.trust_tier <> 'CITIZEN') AS sourced
         FROM event.events e WHERE e.id = $1 AND e.merged_into_id IS NULL`,
      [id],
    );
    return rows[0] ?? null;
  }

  /** Candidatos que no se deben volver a proponer con `eventId`: fusión revertida o par ya en la cola/descartado. */
  private async blockedPairs(q: Queryable, eventId: string, others: string[]): Promise<Set<string>> {
    if (others.length === 0) return new Set();
    const { rows } = await q.query<{ other: string }>(
      `SELECT CASE WHEN target_event_id = $1 THEN merged_event_id ELSE target_event_id END AS other FROM event.merge_log
        WHERE reverted_at IS NOT NULL AND ((target_event_id = $1 AND merged_event_id = ANY($2)) OR (merged_event_id = $1 AND target_event_id = ANY($2)))
       UNION
       SELECT CASE WHEN event_a = $1 THEN event_b ELSE event_a END FROM event.duplicate_candidates
        WHERE (event_a = $1 AND event_b = ANY($2)) OR (event_b = $1 AND event_a = ANY($2))`,
      [eventId, others],
    );
    return new Set(rows.map((r) => r.other));
  }

  private async queueDuplicate(q: Queryable, a: string, b: string, score: number, reason: "AMBIGUOUS_SCORE" | "BOTH_SOURCED"): Promise<number> {
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const res = await q.query(
      `INSERT INTO event.duplicate_candidates (id, event_a, event_b, score, reason) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (event_a, event_b) DO NOTHING`,
      [newId(), lo, hi, score, reason],
    );
    return res.rowCount ?? 0;
  }

  /** Cola de moderación: pares abiertos cuyos dos eventos siguen sin fusionar, los más antiguos primero. */
  async duplicateQueue(q: Queryable, limit = 50): Promise<DuplicateCandidateView[]> {
    const { rows } = await q.query<{ id: string; event_a: string; event_b: string; score: number; reason: DuplicateCandidateView["reason"]; created_at: Date }>(
      `SELECT d.id, d.event_a, d.event_b, d.score, d.reason, d.created_at FROM event.duplicate_candidates d
         JOIN event.events a ON a.id = d.event_a AND a.merged_into_id IS NULL
         JOIN event.events b ON b.id = d.event_b AND b.merged_into_id IS NULL
        WHERE d.status = 'OPEN' ORDER BY d.created_at LIMIT $1`,
      [limit],
    );
    const ids = [...new Set(rows.flatMap((r) => [r.event_a, r.event_b]))];
    const events = ids.length
      ? new Map((await q.query<EventRow>(`SELECT ${PUBLIC_EVENT_COLUMNS} FROM event.events e WHERE e.id = ANY($1)`, [ids])).rows.map((r) => [r.id, toSummary(r)]))
      : new Map<string, EventSummary>();
    return rows.map((r) => ({
      id: r.id, score: r.score, reason: r.reason, createdAt: r.created_at.toISOString(),
      events: [events.get(r.event_a)!, events.get(r.event_b)!],
    }));
  }

  /** "No son el mismo": el par sale de la cola y el barrido no lo vuelve a proponer. */
  async dismissDuplicate(q: Queryable, id: string, moderatorUserId: string, reason: string): Promise<void> {
    const res = await q.query(
      `UPDATE event.duplicate_candidates SET status = 'DISMISSED', resolved_at = now(), resolved_by = $2 WHERE id = $1 AND status = 'OPEN'`,
      [id, `MODERATOR:${moderatorUserId}:${reason.slice(0, 200)}`],
    );
    if (!res.rowCount) throw notFound("Posible duplicado");
  }

  // ───────────── Fusión y división manual (moderación, ADR 0034) ─────────────

  /**
   * Une un duplicado en el destino: sus evidencias activas y sus fotos pasan al destino, el duplicado queda
   * redirigido (`merged_into_id`) y todo se anota en `merge_log` para poder revertirlo. Para los consumidores la
   * fusión equivale a que el destino recibe evidencia nueva (verificación, alertas, feed y reputación se recalculan).
   */
  async merge(tx: Queryable, targetId: string, sourceId: string, actor: string, reason: string, score: number | null = null): Promise<string> {
    if (targetId === sourceId) throw new DomainError("VALIDATION", "Un evento no se puede fusionar consigo mismo");
    const { rows } = await tx.query<{ id: string; merged_into_id: string | null; severity: number; last_activity_at: Date; keywords: string[]; media_hashes: string[] }>(
      `SELECT id, merged_into_id, severity, last_activity_at, keywords, media_hashes FROM event.events WHERE id = ANY($1) ORDER BY id FOR UPDATE`,
      [[targetId, sourceId]],
    );
    const target = rows.find((r) => r.id === targetId);
    const source = rows.find((r) => r.id === sourceId);
    if (!target || !source) throw notFound("Evento");
    if (target.merged_into_id || source.merged_into_id) throw new DomainError("EVENT_ALREADY_MERGED", "Uno de los eventos ya fue fusionado en otro", 409);

    const mergeId = newId();
    const moved = await tx.query<{ id: string }>(
      `UPDATE event.evidence SET event_id = $1 WHERE event_id = $2 AND status = 'ACTIVE' RETURNING id`, [targetId, sourceId],
    );
    await tx.query(
      `UPDATE event.timeline SET event_id = $1, payload = payload || jsonb_build_object('viaMerge', $3::text)
        WHERE event_id = $2 AND type = 'MEDIA_ADDED'`,
      [targetId, sourceId, mergeId],
    );
    await tx.query(`UPDATE event.events SET merged_into_id = $1, updated_at = now() WHERE id = $2`, [targetId, sourceId]);
    // El área oficial del absorbido pasa al destino (ADR 0087).
    await tx.query(
      `UPDATE event.events t SET affected_area = ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SimplifyPreserveTopology(
         ST_Union(coalesce(t.affected_area::geometry, s.affected_area::geometry), s.affected_area::geometry), 0.001)), 3))::geography
         FROM event.events s WHERE t.id = $1 AND s.id = $2 AND s.affected_area IS NOT NULL`,
      [targetId, sourceId],
    );
    await this.addFingerprint(tx, targetId, source.keywords, source.media_hashes);
    await this.recomputeAggregates(tx, targetId, { observedAt: source.last_activity_at.toISOString(), severityHint: source.severity });
    await tx.query(
      `INSERT INTO event.merge_log (id, target_event_id, merged_event_id, reason, actor, moved_evidence, score) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [mergeId, targetId, sourceId, reason, actor, moved.rows.map((r) => r.id), score],
    );
    await tx.query(
      `UPDATE event.duplicate_candidates SET status = 'MERGED', resolved_at = now(), resolved_by = $3
        WHERE status = 'OPEN' AND event_a = LEAST($1::uuid, $2::uuid) AND event_b = GREATEST($1::uuid, $2::uuid)`,
      [targetId, sourceId, actor],
    );
    await this.addTimeline(tx, targetId, "MERGED", { mergedEventId: sourceId });
    await this.addTimeline(tx, sourceId, "MERGED", { intoEventId: targetId });
    await publish(tx, "EventMerged", { mergeId, targetEventId: targetId, mergedEventId: sourceId });
    if (moved.rows[0]) await publish(tx, "EventEvidenceAdded", { eventId: targetId, evidenceId: moved.rows[0].id, evidenceType: "MERGE" });
    return mergeId;
  }

  /** Deshace una fusión: vuelven las evidencias movidas que sigan en el destino y el duplicado reaparece. */
  async revertMerge(tx: Queryable, mergeId: string, moderatorUserId: string, reason: string): Promise<{ targetEventId: string; restoredEventId: string }> {
    const log = (await tx.query<{ target_event_id: string; merged_event_id: string; moved_evidence: string[]; reverted_at: Date | null }>(
      `SELECT target_event_id, merged_event_id, moved_evidence, reverted_at FROM event.merge_log WHERE id = $1 FOR UPDATE`, [mergeId],
    )).rows[0];
    if (!log) throw notFound("Fusión");
    if (log.reverted_at) throw new DomainError("MERGE_ALREADY_REVERTED", "La fusión ya fue revertida", 409);
    const targetId = log.target_event_id, restoredId = log.merged_event_id;
    const back = await tx.query<{ id: string; ref_id: string }>(
      `UPDATE event.evidence SET event_id = $1 WHERE id = ANY($2) AND event_id = $3 RETURNING id, ref_id`, [restoredId, log.moved_evidence, targetId],
    );
    await tx.query(
      `UPDATE event.timeline SET event_id = $1, payload = payload - 'viaMerge' WHERE event_id = $2 AND type = 'MEDIA_ADDED' AND payload->>'viaMerge' = $3`,
      [restoredId, targetId, mergeId],
    );
    await tx.query(`UPDATE event.events SET merged_into_id = NULL, updated_at = now() WHERE id = $1`, [restoredId]);
    const neutral = { observedAt: new Date(0).toISOString() };
    await this.recomputeAggregates(tx, targetId, neutral);
    await this.recomputeAggregates(tx, restoredId, neutral);
    await tx.query(`UPDATE event.merge_log SET reverted_at = now(), reverted_by = $2, revert_reason = $3 WHERE id = $1`, [mergeId, `MODERATOR:${moderatorUserId}`, reason]);
    await this.addTimeline(tx, targetId, "SPLIT", { restoredEventId: restoredId });
    await this.addTimeline(tx, restoredId, "SPLIT", { fromEventId: targetId });
    await publish(tx, "EventMergeReverted", { mergeId, targetEventId: targetId, restoredEventId: restoredId, evidenceRefIds: back.rows.map((r) => r.ref_id) });
    for (const eventId of [targetId, restoredId]) {
      await publish(tx, "EventEvidenceAdded", { eventId, evidenceId: back.rows[0]?.id ?? mergeId, evidenceType: "MERGE_REVERTED" });
    }
    return { targetEventId: targetId, restoredEventId: restoredId };
  }

  /**
   * Separa evidencias a un evento nuevo de la misma categoría (dos sucesos que se unieron por error). El evento
   * original conserva al menos una evidencia; las fotos de los reportes movidos se van con ellos.
   */
  async split(tx: Queryable, sourceId: string, evidenceIds: string[], moderatorUserId: string, reason: string): Promise<string> {
    const source = (await tx.query<{ merged_into_id: string | null; category_code: string }>(
      `SELECT merged_into_id, category_code FROM event.events WHERE id = $1 FOR UPDATE`, [sourceId],
    )).rows[0];
    if (!source) throw notFound("Evento");
    if (source.merged_into_id) throw new DomainError("EVENT_ALREADY_MERGED", "El evento fue fusionado en otro", 409);
    const ids = [...new Set(evidenceIds)];
    const { rows: picked } = await tx.query<{ id: string; ref_id: string; observed_at: Date }>(
      `SELECT id, ref_id, observed_at FROM event.evidence WHERE id = ANY($1) AND event_id = $2 AND status = 'ACTIVE'`, [ids, sourceId],
    );
    if (picked.length !== ids.length) throw new DomainError("VALIDATION", "Alguna evidencia no pertenece al evento o ya no está activa");
    const remaining = await tx.query(`SELECT 1 FROM event.evidence WHERE event_id = $1 AND status = 'ACTIVE' AND NOT (id = ANY($2)) LIMIT 1`, [sourceId, ids]);
    if (!remaining.rowCount) throw new DomainError("SPLIT_WOULD_EMPTY", "El evento original debe conservar al menos una evidencia", 409);

    const newId_ = newId();
    const times = picked.map((p) => p.observed_at.getTime());
    await tx.query(
      `INSERT INTO event.events
         (id, category_code, title, geom, public_geom, public_h3, h3_r7, h3_r9, sensitivity, uncertainty_m, country_code,
          occurred_start, first_seen_at, last_activity_at, severity, publication_state, region_id, district_id, place)
       SELECT $1, category_code, title, geom, public_geom, public_h3, h3_r7, h3_r9, sensitivity, uncertainty_m, country_code,
              $2, now(), $3, severity, publication_state, region_id, district_id, place
         FROM event.events WHERE id = $4`,
      [newId_, new Date(Math.min(...times)), new Date(Math.max(...times)), sourceId],
    );
    await tx.query(`UPDATE event.evidence SET event_id = $1 WHERE id = ANY($2)`, [newId_, ids]);
    const refIds = picked.map((p) => p.ref_id);
    await tx.query(
      `UPDATE event.timeline SET event_id = $1 WHERE event_id = $2 AND type = 'MEDIA_ADDED' AND payload->>'reportId' = ANY($3)`,
      [newId_, sourceId, refIds],
    );
    const neutral = { observedAt: new Date(0).toISOString() };
    await this.recomputeAggregates(tx, newId_, neutral);
    await this.recomputeAggregates(tx, sourceId, neutral);
    await tx.query(
      `INSERT INTO event.split_log (id, source_event_id, new_event_id, evidence_ids, reason, actor) VALUES ($1, $2, $3, $4, $5, $6)`,
      [newId(), sourceId, newId_, ids, reason, `MODERATOR:${moderatorUserId}`],
    );
    await this.addTimeline(tx, newId_, "CREATED", { origin: "SPLIT", fromEventId: sourceId });
    await this.addTimeline(tx, sourceId, "SPLIT", { newEventId: newId_ });
    await publish(tx, "EventCreated", { eventId: newId_, categoryCode: source.category_code });
    await publish(tx, "EventSplit", { sourceEventId: sourceId, newEventId: newId_, evidenceRefIds: refIds });
    for (const eventId of [newId_, sourceId]) {
      await publish(tx, "EventEvidenceAdded", { eventId, evidenceId: picked[0]!.id, evidenceType: "SPLIT" });
    }
    return newId_;
  }

  /** Lo que moderación necesita para fusionar o dividir: evidencias (sin identidad de quien reportó) y fusiones. */
  /** Ítems externos y oficiales que hoy respaldan un evento público (los movidos por una fusión incluidos). */
  async sourceItemRefs(q: Queryable, eventId: string): Promise<string[]> {
    await this.getEvent(q, eventId);
    const { rows } = await q.query<{ ref_id: string }>(
      `SELECT ref_id FROM event.evidence
        WHERE event_id = $1 AND status = 'ACTIVE' AND evidence_type IN ('EXTERNAL_ITEM','OFFICIAL_ITEM','SENSOR')
        ORDER BY observed_at DESC LIMIT 50`,
      [eventId],
    );
    return rows.map((r) => r.ref_id);
  }

  async moderatorDetail(q: Queryable, eventId: string): Promise<ModeratorEventDetail> {
    const ev = (await q.query<{ merged_into_id: string | null; status: EventStatus }>(`SELECT merged_into_id, status FROM event.events WHERE id = $1`, [eventId])).rows[0];
    if (!ev) throw notFound("Evento");
    const evidence = await q.query<{
      id: string; evidence_type: ModeratorEventDetail["evidence"][number]["evidenceType"]; trust_tier: TrustTier; assertion: "OCCURRING" | "NOT_OCCURRING";
      presence_band: string | null; match_confidence: string; observed_at: Date;
    }>(
      `SELECT id, evidence_type, trust_tier, assertion, presence_band, match_confidence, observed_at
         FROM event.evidence WHERE event_id = $1 AND status = 'ACTIVE' ORDER BY observed_at, id LIMIT 500`,
      [eventId],
    );
    const merges = await q.query<{ id: string; target_event_id: string; merged_event_id: string; reason: string; moved: number; at: Date; reverted_at: Date | null }>(
      `SELECT id, target_event_id, merged_event_id, reason, cardinality(moved_evidence) AS moved, at, reverted_at
         FROM event.merge_log WHERE target_event_id = $1 OR merged_event_id = $1 ORDER BY at DESC LIMIT 50`,
      [eventId],
    );
    const changes = await q.query<{ from_status: EventStatus; to_status: EventStatus; reason: string; at: Date }>(
      `SELECT from_status, to_status, reason, at FROM event.status_log WHERE event_id = $1 ORDER BY at DESC LIMIT 20`,
      [eventId],
    );
    return {
      eventId,
      status: ev.status,
      mergedIntoId: ev.merged_into_id,
      statusChanges: changes.rows.map((r) => ({ from: r.from_status, to: r.to_status, reason: r.reason, at: r.at.toISOString() })),
      evidence: evidence.rows.map((r) => ({
        id: r.id, evidenceType: r.evidence_type, trustTier: r.trust_tier, assertion: r.assertion, presenceBand: r.presence_band,
        matchConfidence: r.match_confidence, observedAt: r.observed_at.toISOString(),
      })),
      merges: merges.rows.map((r): EventMergeView => ({
        id: r.id, targetEventId: r.target_event_id, mergedEventId: r.merged_event_id, reason: r.reason, movedEvidence: r.moved,
        at: r.at.toISOString(), revertedAt: r.reverted_at?.toISOString() ?? null,
      })),
    };
  }

  async addTimeline(tx: Queryable, eventId: string, type: TimelineEntryView["type"], payload: Record<string, unknown>, visibility: "PUBLIC" | "INTERNAL" = "PUBLIC"): Promise<void> {
    await tx.query(`INSERT INTO event.timeline (id, event_id, type, payload, visibility) VALUES ($1, $2, $3, $4, $5)`, [
      newId(), eventId, type, JSON.stringify(payload), visibility,
    ]);
  }

  // ───────────── Lecturas (públicas: solo geometría generalizada) ─────────────

  async getEvent(q: Queryable, id: string): Promise<EventSummary & { mergedIntoId: string | null; publicationState: string }> {
    const { rows } = await q.query<EventRow>(`SELECT ${PUBLIC_EVENT_COLUMNS} FROM event.events e WHERE e.id = $1 AND e.publication_state <> 'HIDDEN'`, [id]);
    const r = rows[0];
    if (!r) throw notFound("Evento");
    return { ...toSummary(r), mergedIntoId: r.merged_into_id, publicationState: r.publication_state };
  }

  /** Estado público y sensibilidad de varios eventos (para componer feeds sin leer el esquema event desde fuera). */
  async publicStates(
    q: Queryable,
    ids: string[],
  ): Promise<Map<string, {
    publicVerificationState: PublicVerificationState; sensitivity: Sensitivity; place: ContextualLocation | null;
    severity: number; regionId: string | null; districtId: string | null;
  }>> {
    if (ids.length === 0) return new Map();
    const { rows } = await q.query<{
      id: string; verification_level: VerificationLevel; negative_state: NegativeState; sensitivity: Sensitivity; place: ContextualLocation | null;
      severity: number; region_id: string | null; district_id: string | null;
    }>(
      `SELECT id, verification_level, negative_state, sensitivity, place, severity, region_id, district_id
         FROM event.events WHERE id = ANY($1) AND publication_state <> 'HIDDEN'`,
      [ids],
    );
    return new Map(
      rows.map((r) => [r.id, {
        publicVerificationState: publicVerificationState(r.verification_level, r.negative_state), sensitivity: r.sensitivity, place: r.place,
        severity: r.severity, regionId: r.region_id, districtId: r.district_id,
      }]),
    );
  }

  /** Lo que el Alert Engine necesita de un EVENT: solo datos públicos (lugar contextual, estado, severidad). */
  async alertSnapshot(q: Queryable, id: string): Promise<{
    id: string; categoryCode: string; severity: number; publicState: PublicVerificationState; publicationState: string;
    status: EventSummary["status"]; place: ContextualLocation | null; regionId: string | null; districtId: string | null;
    countryCode: string | null; mergedIntoId: string | null; point: GeoPoint; affectedArea: AreaGeometry | null;
  } | null> {
    const { rows } = await q.query<{
      id: string; category_code: string; severity: number; verification_level: VerificationLevel; negative_state: NegativeState;
      publication_state: string; status: EventSummary["status"]; place: ContextualLocation | null; region_id: string | null;
      district_id: string | null; country_code: string | null; merged_into_id: string | null; lat: number; lng: number; area: unknown; hull: unknown;
    }>(
      `SELECT id, category_code, severity, verification_level, negative_state, publication_state, status, place,
              region_id, district_id, country_code, merged_into_id,
              ST_Y(public_geom::geometry) AS lat, ST_X(public_geom::geometry) AS lng,
              ST_AsGeoJSON(affected_area, 5)::json AS area, ST_AsGeoJSON(ST_Multi(ST_ConvexHull(affected_area::geometry)), 5)::json AS hull
         FROM event.events WHERE id = $1`,
      [id],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id, categoryCode: r.category_code, severity: r.severity, publicState: publicVerificationState(r.verification_level, r.negative_state),
      publicationState: r.publication_state, status: r.status, place: r.place, regionId: r.region_id, districtId: r.district_id,
      countryCode: r.country_code?.trim() ?? null, mergedIntoId: r.merged_into_id, point: { lat: r.lat, lng: r.lng },
      // Si la unión de áreas quedó demasiado compleja para el contrato, se usa su envolvente convexa.
      affectedArea: r.area ? AreaGeometry.safeParse(r.area).data ?? AreaGeometry.safeParse(r.hull).data ?? null : null,
    };
  }

  async timeline(q: Queryable, eventId: string): Promise<TimelineEntryView[]> {
    const { rows } = await q.query<{ id: string; type: TimelineEntryView["type"]; at: Date; payload: Record<string, unknown> }>(
      `SELECT id, type, at, payload FROM event.timeline WHERE event_id = $1 AND visibility = 'PUBLIC' ORDER BY at, id`,
      [eventId],
    );
    // Marcas internas (de qué reporte o fusión viene una foto) no salen en la timeline pública.
    return rows.map((r) => {
      const { reportId: _r, viaMerge: _m, ...payload } = r.payload;
      return { id: r.id, type: r.type, at: r.at.toISOString(), payload };
    });
  }

  /** `verifiedOnly` (ADR 0057): solo corroborados o confirmados y sin disputa. */
  async queryMap(q: Queryable, input: { bbox: [number, number, number, number]; zoom: number; categories?: string[]; verifiedOnly?: boolean }): Promise<EventMapResponse> {
    const [w, s, e, n] = input.bbox;
    const filters = `publication_state = 'PUBLISHED' AND negative_state <> 'FALSE' AND merged_into_id IS NULL
      AND status IN ('ACTIVE','MONITORING','RESOLVED')
      AND public_geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)::geography
      AND ($5::text[] IS NULL OR category_code = ANY($5) OR split_part(category_code, '.', 1) = ANY($5))
      ${input.verifiedOnly ? "AND verification_level <> 'UNVERIFIED' AND negative_state = 'NONE'" : ""}`;
    const params = [w, s, e, n, input.categories?.length ? input.categories : null];
    const res = clusterResolutionForZoom(input.zoom);
    if (res === null) {
      const { rows } = await q.query<EventRow>(
        `SELECT ${PUBLIC_EVENT_COLUMNS} FROM event.events e WHERE ${filters} ORDER BY severity DESC, last_activity_at DESC LIMIT 500`,
        params,
      );
      return { mode: "points", events: rows.map(toSummary), clusters: [] };
    }
    const { rows } = await q.query<{ cell: string; lat: number; lng: number; count: string; max_severity: number }>(
      `SELECT c.cell::text AS cell, (h3_cell_to_lat_lng(c.cell))[1] AS lat, (h3_cell_to_lat_lng(c.cell))[0] AS lng,
              c.count, c.max_severity
         FROM (SELECT h3_lat_lng_to_cell(point(ST_X(public_geom::geometry), ST_Y(public_geom::geometry)), $6) AS cell,
                      count(*) AS count, max(severity) AS max_severity
                 FROM event.events WHERE ${filters} GROUP BY 1) c
        ORDER BY c.count DESC LIMIT 1000`,
      [...params, res],
    );
    return {
      mode: "clusters",
      events: [],
      clusters: rows.map((r) => ({ h3: r.cell, point: { lat: r.lat, lng: r.lng }, count: Number(r.count), maxSeverity: r.max_severity })),
    };
  }

  /**
   * Búsqueda de eventos (RF-02, ADR 0065). Cada palabra (hasta 4) debe coincidir con algo del evento: su categoría
   * (nombre en cualquier idioma del catálogo), su lugar (área del índice propio o subdivisión, o país) o el título que
   * trajo la fuente. Solo eventos publicados y no falsos; los archivados solo si se piden. Orden: vigentes primero,
   * luego cercanía (si se da ubicación) o actividad reciente. Todo en PostgreSQL, sin IA ni buscador externo.
   */
  async search(q: Queryable, raw: unknown): Promise<EventSummary[]> {
    const parsed = EventSearchQuery.safeParse(raw);
    if (!parsed.success) throw new DomainError("VALIDATION", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const { q: text, lat, lng, archived, limit } = parsed.data;
    const words = [...new Set(searchKey(text).split(" ").filter((w) => w.length >= 2))].slice(0, 4);
    if (words.length === 0) return [];
    const params: unknown[] = [];
    const p = (v: unknown) => `$${params.push(v)}`;
    const clauses: string[] = [];
    for (const w of words) {
      const codes = this.ref.categories.categories
        .filter((c) => Object.values(c.names).some((n) => { const k = searchKey(n); return k.startsWith(w) || k.includes(` ${w}`); }))
        .map((c) => c.code);
      const place = await this.geo.placeMatches(q, w);
      const like = `%${w.replace(/[\\%_]/g, "\\$&")}%`;
      clauses.push(`(
        e.category_code = ANY(${p(codes)}) OR split_part(e.category_code, '.', 1) = ANY(${p(codes)})
        OR e.region_id = ANY(${p(place.areaIds)}) OR e.district_id = ANY(${p(place.areaIds)})
        OR e.country_code = ANY(${p(place.countries)})
        OR EXISTS (SELECT 1 FROM jsonb_each_text(coalesce(e.title, '{}')) t WHERE lower(t.value) LIKE ${p(like)})
      )`);
    }
    const near = lat !== undefined && lng !== undefined ? { lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100 } : null;
    const order = near
      ? `e.public_geom <-> ST_SetSRID(ST_MakePoint(${p(near.lng)}, ${p(near.lat)}), 4326)::geography`
      : "e.last_activity_at DESC";
    const { rows } = await q.query<EventRow>(
      `SELECT ${PUBLIC_EVENT_COLUMNS} FROM event.events e
        WHERE e.publication_state = 'PUBLISHED' AND e.negative_state <> 'FALSE' AND e.merged_into_id IS NULL
          AND e.status IN ('ACTIVE','MONITORING','RESOLVED'${archived === "1" ? ",'ARCHIVED'" : ""})
          AND ${clauses.join(" AND ")}
        ORDER BY (e.status IN ('ACTIVE','MONITORING')) DESC, ${order}, e.id
        LIMIT ${p(limit)}`,
      params,
    );
    return rows.map(toSummary);
  }

  /**
   * Eventos cercanos para la pregunta "¿es este?" antes de reportar. La distancia se devuelve por tramos
   * (no exacta) para no permitir triangular la ubicación interna del evento.
   */
  async nearby(q: Queryable, input: { point: GeoPoint; categoryCode: string }): Promise<NearbyEvent[]> {
    const country = this.geo.countryOf(input.point);
    const category = this.ref.category(input.categoryCode, country);
    if (!category) return [];
    const root = input.categoryCode.split(".")[0]!;
    const { rows } = await q.query<EventRow & { ilat: number; ilng: number }>(
      `SELECT ${PUBLIC_EVENT_COLUMNS}, ST_Y(e.geom::geometry) AS ilat, ST_X(e.geom::geometry) AS ilng
         FROM event.events e
        WHERE e.status IN ('ACTIVE','MONITORING') AND e.merged_into_id IS NULL AND e.negative_state <> 'FALSE'
          AND e.publication_state <> 'HIDDEN'
          AND (e.category_code = ANY($1) OR e.category_code LIKE $2)
          AND ST_DWithin(e.geom, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, $5)
          AND e.last_activity_at >= now() - make_interval(mins => $6)
        LIMIT 20`,
      [[input.categoryCode, ...category.compatibleWith], `${root}.%`, input.point.lng, input.point.lat, category.dedupRadiusM * 1.5, category.dedupWindowMinutes],
    );
    const now = new Date();
    return rows
      .map((r) => {
        const internal = { lat: r.ilat, lng: r.ilng };
        const score = matchScore(
          { categoryCode: input.categoryCode, point: input.point, observedAt: now, dedupRadiusM: category.dedupRadiusM * 1.5, dedupWindowMinutes: category.dedupWindowMinutes, compatibleWith: category.compatibleWith },
          { id: r.id, categoryCode: r.category_code, point: internal, lastActivityAt: r.last_activity_at },
        );
        const d = distanceMeters(input.point, internal);
        const distanceBucket = d < 100 ? "<100m" : d < 500 ? "<500m" : d < 2000 ? "<2km" : ">2km";
        return { ...toSummary(r), matchScore: score, distanceBucket } as NearbyEvent;
      })
      .filter((e) => e.matchScore > 0)
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, 5);
  }

  /**
   * Ciclo de vida por inactividad (determinista y barato, en lote): ACTIVE → MONITORING tras 2 ventanas de
   * deduplicación sin actividad; MONITORING → RESOLVED tras 6 (mínimo 24 h). Cada cambio queda en la timeline.
   */
  async applyLifecycle(q: Queryable, now: Date): Promise<{ monitoring: number; resolved: number }> {
    const cats = this.ref.categories.categories;
    const codes = cats.map((c) => c.code);
    const monitorMin = cats.map((c) => c.dedupWindowMinutes * 2);
    const resolveMin = cats.map((c) => Math.max(c.dedupWindowMinutes * 6, 1440));
    const moved = await q.query<{ id: string; status: string }>(
      `WITH cfg AS (SELECT * FROM unnest($1::text[], $2::int[], $3::int[]) AS t(code, monitor_min, resolve_min))
       UPDATE event.events e SET
          status = CASE WHEN e.last_activity_at < $4::timestamptz - make_interval(mins => cfg.resolve_min) THEN 'RESOLVED' ELSE 'MONITORING' END,
          updated_at = now()
         FROM cfg
        WHERE cfg.code = e.category_code AND e.merged_into_id IS NULL
          AND ((e.status = 'ACTIVE' AND e.last_activity_at < $4::timestamptz - make_interval(mins => cfg.monitor_min))
            OR (e.status = 'MONITORING' AND e.last_activity_at < $4::timestamptz - make_interval(mins => cfg.resolve_min)))
       RETURNING e.id, e.status`,
      [codes, monitorMin, resolveMin, now],
    );
    for (const r of moved.rows) {
      await this.addTimeline(q, r.id, "STATUS_CHANGED", { to: r.status, cause: "INACTIVITY" });
      await publish(q, "EventLifecycleChanged", { eventId: r.id, to: r.status as "MONITORING" | "RESOLVED" }, { lane: "normal" });
    }
    return {
      monitoring: moved.rows.filter((r) => r.status === "MONITORING").length,
      resolved: moved.rows.filter((r) => r.status === "RESOLVED").length,
    };
  }

  /**
   * Cambio manual del ciclo de vida por moderación (ADR 0053): cerrar antes un evento que terminó, archivar uno que
   * no aporta o reactivar uno cerrado por inactividad. Reactivar reinicia `last_activity_at` para que el ciclo
   * automático no lo vuelva a cerrar enseguida. Un evento fusionado se gestiona desde el que lo absorbió.
   */
  async setStatus(tx: Queryable, eventId: string, to: EventStatus, actor: string, reason: string): Promise<void> {
    const ev = (await tx.query<{ status: EventStatus; merged_into_id: string | null }>(
      `SELECT status, merged_into_id FROM event.events WHERE id = $1 FOR UPDATE`, [eventId],
    )).rows[0];
    if (!ev) throw notFound("Evento");
    if (ev.merged_into_id) throw new DomainError("CONFLICT", "El evento está fusionado en otro", 409);
    if (ev.status === to) throw new DomainError("CONFLICT", "El evento ya está en ese estado", 409);
    await tx.query(
      `UPDATE event.events SET status = $2, updated_at = now(), last_activity_at = CASE WHEN $2 = 'ACTIVE' THEN now() ELSE last_activity_at END WHERE id = $1`,
      [eventId, to],
    );
    await tx.query(`INSERT INTO event.status_log (id, event_id, from_status, to_status, reason, actor) VALUES ($1, $2, $3, $4, $5, $6)`, [
      newId(), eventId, ev.status, to, reason, actor,
    ]);
    await this.addTimeline(tx, eventId, "STATUS_CHANGED", { from: ev.status, to, cause: "MODERATION" });
    await publish(tx, "EventLifecycleChanged", { eventId, to }, { lane: "normal" });
  }

  /**
   * Fin oficial (ADR 0059): un evento cuya evidencia activa es SOLO de fuentes y todas terminaron (retiradas o
   * expiradas) pasa a RESOLVED. Si hay un reporte ciudadano o una fuente vigente, no se toca: sigue el ciclo por
   * inactividad. `ended` lo da ingestion (ids de ítems externos con su motivo).
   */
  async applySourceEnd(q: Queryable, ended: { id: string; reason: "WITHDRAWN" | "EXPIRED" }[]): Promise<number> {
    if (ended.length === 0) return 0;
    const reasonById = new Map(ended.map((e) => [e.id, e.reason]));
    const { rows } = await q.query<{ id: string; status: EventStatus; refs: string[] }>(
      `SELECT e.id, e.status, array_agg(ev.ref_id::text) AS refs
         FROM event.events e JOIN event.evidence ev ON ev.event_id = e.id AND ev.status = 'ACTIVE'
        WHERE e.status IN ('ACTIVE','MONITORING') AND e.merged_into_id IS NULL
          AND e.id IN (SELECT event_id FROM event.evidence WHERE ref_id::text = ANY($1) AND status = 'ACTIVE')
        GROUP BY e.id, e.status
       HAVING bool_and(ev.ref_id::text = ANY($1))`,
      [[...reasonById.keys()]],
    );
    for (const r of rows) {
      const withdrawn = r.refs.some((ref) => reasonById.get(ref) === "WITHDRAWN");
      await q.query(`UPDATE event.events SET status = 'RESOLVED', updated_at = now() WHERE id = $1`, [r.id]);
      await this.addTimeline(q, r.id, "STATUS_CHANGED", { from: r.status, to: "RESOLVED", cause: withdrawn ? "SOURCE_WITHDRAWN" : "SOURCE_EXPIRED" });
      await publish(q, "EventLifecycleChanged", { eventId: r.id, to: "RESOLVED" }, { lane: "normal" });
    }
    return rows.length;
  }

  /**
   * D-ARCHIVE (ADR 0061): un evento RESOLVED sigue en el mapa `archiveAfterDays` días y luego pasa a ARCHIVED. No se
   * borra nada: reportes, fuentes, historial y verificación quedan, y sigue accesible por enlace. Moderación puede
   * reactivarlo (ADR 0053).
   */
  async archiveResolved(q: Queryable, now: Date): Promise<number> {
    const { rows } = await q.query<{ id: string }>(
      `UPDATE event.events SET status = 'ARCHIVED', updated_at = now()
        WHERE status = 'RESOLVED' AND resolved_at < $1::timestamptz - make_interval(days => $2)
       RETURNING id`,
      [now, this.opts.archiveAfterDays],
    );
    for (const r of rows) {
      await this.addTimeline(q, r.id, "STATUS_CHANGED", { from: "RESOLVED", to: "ARCHIVED", cause: "ARCHIVE_AFTER_RESOLVED" });
      await publish(q, "EventLifecycleChanged", { eventId: r.id, to: "ARCHIVED" }, { lane: "batch" });
    }
    return rows.length;
  }

  // ───────────── Interfaz para el Verification Engine ─────────────

  async evidenceForVerification(q: Queryable, eventId: string): Promise<{ categoryCode: string; countryCode: string | null; evidence: EvidenceForVerification[] }> {
    const ev = (await q.query<{ category_code: string; country_code: string | null }>(`SELECT category_code, country_code FROM event.events WHERE id = $1`, [eventId])).rows[0];
    if (!ev) throw notFound("Evento");
    const { rows } = await q.query<{
      id: string; evidence_type: string; ref_id: string; trust_tier: TrustTier; assertion: "OCCURRING" | "NOT_OCCURRING";
      presence_band: string | null; contributor_user_id: string | null; contributor_device_id: string | null; observed_at: Date;
      text_hash: string | null;
    }>(
      `SELECT id, evidence_type, ref_id, trust_tier, assertion, presence_band, contributor_user_id, contributor_device_id, observed_at, text_hash
         FROM event.evidence WHERE event_id = $1 AND status = 'ACTIVE' ORDER BY added_at`,
      [eventId],
    );
    return {
      categoryCode: ev.category_code,
      countryCode: ev.country_code?.trim() ?? null,
      evidence: rows.map((r) => ({
        id: r.id, evidenceType: r.evidence_type, refId: r.ref_id, trustTier: r.trust_tier, assertion: r.assertion,
        presenceBand: r.presence_band, contributorUserId: r.contributor_user_id, contributorDeviceId: r.contributor_device_id,
        textHash: r.text_hash, observedAt: r.observed_at,
      })),
    };
  }

  /** ¿Este origen creó el evento? (para que el Report Engine informe CREATED_EVENT vs ATTACHED_TO_EVENT). */
  async wasCreatedBy(q: Queryable, eventId: string, refId: string): Promise<boolean> {
    const { rows } = await q.query(`SELECT 1 FROM event.evidence WHERE event_id = $1 AND ref_id = $2 AND match_confidence = 'NEW_EVENT'`, [eventId, refId]);
    return rows.length > 0;
  }

  readonly dedupRuleVersion = DEDUP_RULES.version;

  // ───────────── Calidad (ADR 0026) ─────────────

  /** EVENTs creados en el periodo y cuántos terminaron fusionados en otro (duplicados que la resolución no evitó). */
  async qualityStats(q: Queryable, from: Date, to: Date): Promise<{ created: number; merged: number; autoMerged: number; autoMergeReverted: number; duplicatesOpen: number }> {
    const { rows } = await q.query<{ created: number; merged: number }>(
      `SELECT count(*)::int AS created, count(*) FILTER (WHERE merged_into_id IS NOT NULL)::int AS merged
         FROM event.events WHERE created_at >= $1 AND created_at < $2`,
      [from, to],
    );
    const auto = await q.query<{ auto_merged: number; reverted: number; open: number }>(
      `SELECT count(*)::int AS auto_merged, count(*) FILTER (WHERE reverted_at IS NOT NULL)::int AS reverted,
              (SELECT count(*)::int FROM event.duplicate_candidates WHERE status = 'OPEN') AS open
         FROM event.merge_log WHERE actor LIKE 'RULE:%' AND at >= $1 AND at < $2`,
      [from, to],
    );
    const a = auto.rows[0]!;
    return { ...rows[0]!, autoMerged: a.auto_merged, autoMergeReverted: a.reverted, duplicatesOpen: a.open };
  }

  async createdAt(q: Queryable, ids: string[]): Promise<Map<string, Date>> {
    if (ids.length === 0) return new Map();
    const { rows } = await q.query<{ id: string; created_at: Date }>(`SELECT id, created_at FROM event.events WHERE id = ANY($1)`, [ids]);
    return new Map(rows.map((r) => [r.id, r.created_at]));
  }
}

/** Fusión automática (ADR 0076): mismas bandas que dedup-2; esto solo acota el barrido. */
export const AUTO_MERGE = { actor: "RULE:auto-merge", lookbackHours: 24, maxEventsPerRun: 200 } as const;

/** Destino de una fusión automática: el de mayor nivel, luego el que tiene fuentes, luego el más antiguo. */
export function mergeOrder<T extends { id: string; verification_level: VerificationLevel; sourced: boolean; first_seen_at: Date }>(a: T, b: T): [T, T] {
  const key = (e: T) => [VERIFICATION_LEVEL_RANK[e.verification_level] ?? 0, e.sourced ? 1 : 0, -e.first_seen_at.getTime()] as const;
  const [ka, kb] = [key(a), key(b)];
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i]! > kb[i]! ? [a, b] : [b, a];
  return a.id < b.id ? [a, b] : [b, a];
}
