import type {
  CategoryConfig,
  ContextualLocation,
  NearbyEvent,
  EventCandidate,
  EventMapResponse,
  EventSummary,
  GeoPoint,
  NegativeState,
  PublicVerificationState,
  Sensitivity,
  TimelineEntryView,
  TrustTier,
  VerificationLevel,
} from "@dizaster/contracts";
import { publicVerificationState } from "@dizaster/contracts";
import {
  DEDUP_RULES_V1,
  H3_RES,
  clusterResolutionForZoom,
  decideDedup,
  categoryCompatibility,
  distanceMeters,
  matchScore,
  weightedMedianPoint,
  type DedupCandidateEvent,
} from "@dizaster/geo-kit";
import type { Queryable } from "../../platform/db.js";
import { notFound } from "../../platform/errors.js";
import { newId } from "../../platform/ids.js";
import { publish, type OutboxDispatcher } from "../../platform/outbox.js";
import type { GeoService } from "../geo/index.js";
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
  ) {}

  registerHandlers(dispatcher: OutboxDispatcher): void {
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
    const root = c.categoryCode.split(".")[0]!;
    const { rows } = await tx.query<{ id: string; category_code: string; lat: number; lng: number; last_activity_at: Date }>(
      `SELECT id, category_code, ST_Y(geom::geometry) AS lat, ST_X(geom::geometry) AS lng, last_activity_at
         FROM event.events
        WHERE status IN ('ACTIVE','MONITORING') AND merged_into_id IS NULL AND negative_state <> 'FALSE'
          AND (category_code = ANY($1) OR category_code LIKE $2)
          AND ST_DWithin(geom, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, $5)
          AND last_activity_at >= $6::timestamptz - make_interval(mins => $7)
        LIMIT 50`,
      [
        [c.categoryCode, ...category.compatibleWith], `${root}.%`, c.point.lng, c.point.lat,
        category.dedupRadiusM, c.observedAt, category.dedupWindowMinutes,
      ],
    );
    return rows.map((r) => ({ id: r.id, categoryCode: r.category_code, point: { lat: r.lat, lng: r.lng }, lastActivityAt: r.last_activity_at }));
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
          contributor_user_id, contributor_device_id, match_score, match_confidence, added_by, observed_at)
       VALUES ($1, $2, $3, $4, $5, $6, ST_SetSRID(ST_MakePoint($7, $8), 4326)::geography, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        evidenceId, eventId, evidenceType, c.originRef.id, c.trustTier, assertion, c.point.lng, c.point.lat, c.weight,
        (c.metadata["presenceBand"] as string | undefined) ?? null, c.contributor?.userId ?? null, c.contributor?.deviceId ?? null,
        score, confidence, confidence === "USER_SELECTED" ? "USER" : "RULE", c.observedAt,
      ],
    );
    await this.recomputeAggregates(tx, eventId, c);
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

  /** Geometría y contadores agregados. Una fuente oficial prevalece; si no, mediana ponderada (robusta a pines atípicos). */
  private async recomputeAggregates(tx: Queryable, eventId: string, c: EventCandidate): Promise<void> {
    const { rows } = await tx.query<{ lat: number; lng: number; weight: number; trust_tier: TrustTier; contributor_user_id: string | null; observed_at: Date }>(
      `SELECT ST_Y(point::geometry) AS lat, ST_X(point::geometry) AS lng, weight, trust_tier, contributor_user_id, observed_at
         FROM event.evidence WHERE event_id = $1 AND status = 'ACTIVE' AND assertion = 'OCCURRING'`,
      [eventId],
    );
    const ev = (await tx.query<{ sensitivity: EventSummary["sensitivity"]; publication_state: string }>(
      `SELECT sensitivity, publication_state FROM event.events WHERE id = $1`, [eventId],
    )).rows[0];
    if (!ev || rows.length === 0) {
      await tx.query(`UPDATE event.events SET last_activity_at = greatest(last_activity_at, $2), updated_at = now() WHERE id = $1`, [eventId, c.observedAt]);
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
    countryCode: string | null; mergedIntoId: string | null; point: GeoPoint;
  } | null> {
    const { rows } = await q.query<{
      id: string; category_code: string; severity: number; verification_level: VerificationLevel; negative_state: NegativeState;
      publication_state: string; status: EventSummary["status"]; place: ContextualLocation | null; region_id: string | null;
      district_id: string | null; country_code: string | null; merged_into_id: string | null; lat: number; lng: number;
    }>(
      `SELECT id, category_code, severity, verification_level, negative_state, publication_state, status, place,
              region_id, district_id, country_code, merged_into_id,
              ST_Y(public_geom::geometry) AS lat, ST_X(public_geom::geometry) AS lng
         FROM event.events WHERE id = $1`,
      [id],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id, categoryCode: r.category_code, severity: r.severity, publicState: publicVerificationState(r.verification_level, r.negative_state),
      publicationState: r.publication_state, status: r.status, place: r.place, regionId: r.region_id, districtId: r.district_id,
      countryCode: r.country_code?.trim() ?? null, mergedIntoId: r.merged_into_id, point: { lat: r.lat, lng: r.lng },
    };
  }

  async timeline(q: Queryable, eventId: string): Promise<TimelineEntryView[]> {
    const { rows } = await q.query<{ id: string; type: TimelineEntryView["type"]; at: Date; payload: Record<string, unknown> }>(
      `SELECT id, type, at, payload FROM event.timeline WHERE event_id = $1 AND visibility = 'PUBLIC' ORDER BY at, id`,
      [eventId],
    );
    return rows.map((r) => ({ id: r.id, type: r.type, at: r.at.toISOString(), payload: r.payload }));
  }

  async queryMap(q: Queryable, input: { bbox: [number, number, number, number]; zoom: number; categories?: string[] }): Promise<EventMapResponse> {
    const [w, s, e, n] = input.bbox;
    const filters = `publication_state = 'PUBLISHED' AND negative_state <> 'FALSE' AND merged_into_id IS NULL
      AND status IN ('ACTIVE','MONITORING')
      AND public_geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)::geography
      AND ($5::text[] IS NULL OR category_code = ANY($5) OR split_part(category_code, '.', 1) = ANY($5))`;
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

  // ───────────── Interfaz para el Verification Engine ─────────────

  async evidenceForVerification(q: Queryable, eventId: string): Promise<{ categoryCode: string; countryCode: string | null; evidence: EvidenceForVerification[] }> {
    const ev = (await q.query<{ category_code: string; country_code: string | null }>(`SELECT category_code, country_code FROM event.events WHERE id = $1`, [eventId])).rows[0];
    if (!ev) throw notFound("Evento");
    const { rows } = await q.query<{
      id: string; evidence_type: string; ref_id: string; trust_tier: TrustTier; assertion: "OCCURRING" | "NOT_OCCURRING";
      presence_band: string | null; contributor_user_id: string | null; contributor_device_id: string | null; observed_at: Date;
    }>(
      `SELECT id, evidence_type, ref_id, trust_tier, assertion, presence_band, contributor_user_id, contributor_device_id, observed_at
         FROM event.evidence WHERE event_id = $1 AND status = 'ACTIVE' ORDER BY added_at`,
      [eventId],
    );
    return {
      categoryCode: ev.category_code,
      countryCode: ev.country_code?.trim() ?? null,
      evidence: rows.map((r) => ({
        id: r.id, evidenceType: r.evidence_type, refId: r.ref_id, trustTier: r.trust_tier, assertion: r.assertion,
        presenceBand: r.presence_band, contributorUserId: r.contributor_user_id, contributorDeviceId: r.contributor_device_id,
        observedAt: r.observed_at,
      })),
    };
  }

  /** ¿Este origen creó el evento? (para que el Report Engine informe CREATED_EVENT vs ATTACHED_TO_EVENT). */
  async wasCreatedBy(q: Queryable, eventId: string, refId: string): Promise<boolean> {
    const { rows } = await q.query(`SELECT 1 FROM event.evidence WHERE event_id = $1 AND ref_id = $2 AND match_confidence = 'NEW_EVENT'`, [eventId, refId]);
    return rows.length > 0;
  }

  readonly dedupRuleVersion = DEDUP_RULES_V1.version;

  // ───────────── Calidad (ADR 0026) ─────────────

  /** EVENTs creados en el periodo y cuántos terminaron fusionados en otro (duplicados que la resolución no evitó). */
  async qualityStats(q: Queryable, from: Date, to: Date): Promise<{ created: number; merged: number }> {
    const { rows } = await q.query<{ created: number; merged: number }>(
      `SELECT count(*)::int AS created, count(*) FILTER (WHERE merged_into_id IS NOT NULL)::int AS merged
         FROM event.events WHERE created_at >= $1 AND created_at < $2`,
      [from, to],
    );
    return rows[0]!;
  }

  async createdAt(q: Queryable, ids: string[]): Promise<Map<string, Date>> {
    if (ids.length === 0) return new Map();
    const { rows } = await q.query<{ id: string; created_at: Date }>(`SELECT id, created_at FROM event.events WHERE id = ANY($1)`, [ids]);
    return new Map(rows.map((r) => [r.id, r.created_at]));
  }
}
