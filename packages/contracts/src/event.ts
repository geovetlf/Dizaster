import { z } from "zod";
import { CategoryCode, CountryCode, Instant, LocalizedText } from "./common.js";
import { GeoPoint, Sensitivity } from "./geo.js";
import { NegativeState, PublicVerificationState, TrustTier, VerificationLevel } from "./verification.js";

export const EventStatus = z.enum(["ACTIVE", "MONITORING", "RESOLVED", "ARCHIVED"]);
export type EventStatus = z.infer<typeof EventStatus>;

/** Un evento creado por presencia media queda pendiente hasta que otra evidencia lo respalde. */
export const PublicationState = z.enum(["PUBLISHED", "PENDING_CORROBORATION", "HIDDEN"]);
export type PublicationState = z.infer<typeof PublicationState>;

/** Origen de un candidato. Abierto a orígenes futuros (sensores, drones, live...). */
export const CandidateOrigin = z.enum(["CITIZEN_REPORT", "OFFICIAL", "EXTERNAL", "OPEN_DATA", "NEWS", "SENSOR"]);
export type CandidateOrigin = z.infer<typeof CandidateOrigin>;

export const EvidenceType = z.enum(["CITIZEN_REPORT", "EXTERNAL_ITEM", "OFFICIAL_ITEM", "MEDIA", "MODERATOR_NOTE", "SENSOR"]);
export type EvidenceType = z.infer<typeof EvidenceType>;

export const TimelineEntryType = z.enum([
  "CREATED",
  "REPORT_ADDED",
  "COUNTER_REPORT_ADDED",
  "SOURCE_ADDED",
  "OFFICIAL_UPDATE",
  "VERIFICATION_CHANGED",
  "NEGATIVE_STATE_CHANGED",
  "STATUS_CHANGED",
  "MEDIA_ADDED",
  "MERGED",
  "SPLIT",
  "LIVE_STARTED",
  "LIVE_ENDED",
]);
export type TimelineEntryType = z.infer<typeof TimelineEntryType>;

/** El formato común al que se reduce TODA entrada antes de resolverse en un EVENT. */
export const EventCandidate = z.object({
  origin: CandidateOrigin,
  originRef: z.object({ kind: z.enum(["REPORT", "EXTERNAL_ITEM", "SENSOR_READING"]), id: z.uuid() }),
  categoryCode: CategoryCode,
  point: GeoPoint,
  locationUncertaintyM: z.number().nonnegative(),
  occurredAt: Instant,
  observedAt: Instant,
  severityHint: z.number().int().min(1).max(5).optional(),
  title: LocalizedText.optional(),
  trustTier: TrustTier,
  /** Peso de la evidencia (p. ej. presence_score de un reporte). */
  weight: z.number().min(0).max(1),
  /** Solo reportes: identidad para contar corroboración independiente. */
  contributor: z.object({ userId: z.uuid(), deviceId: z.uuid().nullable() }).optional(),
  /** Si el usuario eligió "es este evento" al reportar. */
  userSelectedEventId: z.uuid().optional(),
  /** Si false, el candidato solo puede adjuntarse a un evento existente. */
  mayCreateEvent: z.boolean(),
  /** Si true, el evento creado queda PENDING_CORROBORATION. */
  createAsPending: z.boolean().default(false),
  externalIds: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type EventCandidate = z.infer<typeof EventCandidate>;

/** Vista pública: NUNCA contiene la ubicación de ningún reportante, solo la geometría pública generalizada. */
export const EventSummary = z.object({
  id: z.uuid(),
  categoryCode: CategoryCode,
  title: LocalizedText.nullable(),
  point: GeoPoint,
  sensitivity: Sensitivity,
  countryCode: CountryCode.nullable(),
  status: EventStatus,
  severity: z.number().int(),
  verificationLevel: VerificationLevel,
  negativeState: NegativeState,
  publicVerificationState: PublicVerificationState,
  reportCount: z.number().int(),
  sourceCount: z.number().int(),
  firstSeenAt: Instant,
  lastActivityAt: Instant,
});
export type EventSummary = z.infer<typeof EventSummary>;

export const TimelineEntryView = z.object({
  id: z.uuid(),
  type: TimelineEntryType,
  at: Instant,
  payload: z.record(z.string(), z.unknown()),
});
export type TimelineEntryView = z.infer<typeof TimelineEntryView>;

export const EventCluster = z.object({
  h3: z.string(),
  point: GeoPoint,
  count: z.number().int(),
  maxSeverity: z.number().int(),
});
export type EventCluster = z.infer<typeof EventCluster>;

export const EventMapResponse = z.object({
  mode: z.enum(["points", "clusters"]),
  events: z.array(EventSummary),
  clusters: z.array(EventCluster),
});
export type EventMapResponse = z.infer<typeof EventMapResponse>;

/** "¿Es este el mismo evento?": candidatos cercanos que el reportero puede elegir antes de enviar. */
export const NearbyEvent = EventSummary.extend({ matchScore: z.number(), distanceBucket: z.enum(["<100m", "<500m", "<2km", ">2km"]) });
export type NearbyEvent = z.infer<typeof NearbyEvent>;
export const NearbyEventsResponse = z.object({ events: z.array(NearbyEvent) });
export type NearbyEventsResponse = z.infer<typeof NearbyEventsResponse>;
