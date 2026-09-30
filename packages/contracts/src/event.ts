import { z } from "zod";
import { CategoryCode, CountryCode, Instant, LocalizedText } from "./common.js";
import { AreaGeometry, ContextualLocation, GeoPoint, Sensitivity } from "./geo.js";
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
  /** La gravedad cambió por la evidencia o por corrección de moderación (ADR 0160). */
  "SEVERITY_CHANGED",
  "MEDIA_ADDED",
  "MERGED",
  "SPLIT",
  "REPORT_WITHDRAWN",
  /** Moderación ocultó o retiró un reporte: deja de contar (ADR 0143). Restaurar lo devuelve. */
  "REPORT_MODERATED",
  "REPORT_RESTORED",
  /** Nota de moderación (ADR 0147): INTERNA, nunca sale por la timeline pública. */
  "MODERATOR_NOTE",
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
  /** Hash perceptual de las fotos ya procesadas del reporte (sim_media en la deduplicación, ADR 0030). */
  mediaHashes: z.array(z.string().regex(/^[0-9a-f]{16}$/)).max(8).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
  /** Área oficial afectada (ADR 0087). Se ignora si el candidato es ciudadano. */
  affectedArea: AreaGeometry.optional(),
});
export type EventCandidate = z.infer<typeof EventCandidate>;

/** Vista pública: NUNCA contiene la ubicación de ningún reportante, solo la geometría pública generalizada. */
export const EventSummary = z.object({
  id: z.uuid(),
  categoryCode: CategoryCode,
  /** Otras categorías compatibles que aportan sus reportes o fuentes (p. ej. un choque que además corta la vía). */
  secondaryCategories: z.array(CategoryCode).default([]),
  title: LocalizedText.nullable(),
  point: GeoPoint,
  sensitivity: Sensitivity,
  countryCode: CountryCode.nullable(),
  /** País → región → ciudad → distrito, derivado del punto público (null si aún no hay índice geográfico). */
  place: ContextualLocation.nullable(),
  status: EventStatus,
  severity: z.number().int(),
  verificationLevel: VerificationLevel,
  negativeState: NegativeState,
  publicVerificationState: PublicVerificationState,
  reportCount: z.number().int(),
  /** Fuentes no ciudadanas (externas + oficiales). */
  sourceCount: z.number().int(),
  /** De ellas, oficiales registradas (ADR 0117). Las externas son la diferencia. */
  officialSourceCount: z.number().int(),
  firstSeenAt: Instant,
  /**
   * Hora del suceso (§7.3 occurred_start, ADR 0224): la que da la fuente (p. ej. el origen de un sismo) o la captura
   * del primer reporte. Puede ser anterior a `firstSeenAt` (cuándo lo supo Dizaster).
   */
  startedAt: Instant.nullable().optional(),
  lastActivityAt: Instant,
  /** Hora de fin (§7.3 occurred_end, ADR 0140): solo en eventos RESOLVED o ARCHIVED. */
  endedAt: Instant.nullable().optional(),
});
export type EventSummary = z.infer<typeof EventSummary>;

/** GET /v1/events/:id: si el evento se fusionó, `mergedIntoId` es el destino al que la app redirige (ADR 0093). */
export type EventDetail = EventSummary & {
  mergedIntoId: string | null;
  publicationState: string;
  /** Área oficial afectada simplificada (ADR 0144): solo la aportan fuentes externas u oficiales, nunca un reporte. */
  affectedArea?: AffectedAreaView | null;
};
export interface AffectedAreaView { type: "MultiPolygon"; coordinates: number[][][][] }

export const TimelineEntryView = z.object({
  id: z.uuid(),
  type: TimelineEntryType,
  at: Instant,
  payload: z.record(z.string(), z.unknown()),
});
export type TimelineEntryView = z.infer<typeof TimelineEntryView>;

/**
 * Página cronológica (ADR 0106): timeline de un evento y comentarios de un post. `cursor` es el id del último
 * elemento recibido; `order` elige de lo más antiguo a lo más nuevo (por defecto) o al revés.
 */
export const ChronoPageQuery = z.object({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(200),
  order: z.enum(["asc", "desc"]).default("asc"),
});
export type ChronoPageQuery = z.infer<typeof ChronoPageQuery>;

/** Galería del evento por páginas (ADR 0203): cada página son entradas de media de la timeline, en orden. */
export const GalleryPageQuery = z.object({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type GalleryPageQuery = z.infer<typeof GalleryPageQuery>;

export const EventCluster = z.object({
  h3: z.string(),
  point: GeoPoint,
  count: z.number().int(),
  maxSeverity: z.number().int(),
});
export type EventCluster = z.infer<typeof EventCluster>;

/**
 * Ventana de tiempo del mapa (§6.3 `since`, ADR 0123): actividad en las últimas N horas. Ventanas fijas y no una
 * fecha libre, para que la misma tesela tenga la misma URL para todos y la CDN la comparta.
 */
export const MapWindow = z.enum(["6h", "24h", "7d"]);
export type MapWindow = z.infer<typeof MapWindow>;
export const MAP_WINDOW_HOURS: Record<MapWindow, number> = { "6h": 6, "24h": 24, "7d": 168 };

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

/**
 * Búsqueda de eventos (RF-02, ADR 0065). Determinista: cada palabra debe coincidir con la categoría (en cualquier
 * idioma del catálogo), el lugar (índice geográfico propio) o el título de la fuente. Sin IA ni buscador externo.
 */
export const EventSearchQuery = z.object({
  q: z.string().trim().min(2).max(80),
  /** Ubicación aproximada del lector para ordenar por cercanía; se redondea a 2 decimales. */
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  /** "1" incluye los archivados (historial, ADR 0061). */
  archived: z.enum(["0", "1"]).default("0"),
  limit: z.coerce.number().int().min(1).max(30).default(20),
});
export const EventSearchResponse = z.object({ events: z.array(EventSummary) });
export type EventSearchResponse = z.infer<typeof EventSearchResponse>;

// ───────────── Fusión y división manual por moderación (Blueprint §5.7, §6.1; ADR 0034) ─────────────

const ModeratorReason = z.string().trim().min(10).max(1000);

/** Unir duplicados en el evento destino. Cada fusión queda registrada y se puede revertir. */
export const MergeEventsRequest = z.object({
  sourceEventIds: z.array(z.uuid()).min(1).max(10),
  reason: ModeratorReason,
});
export type MergeEventsRequest = z.infer<typeof MergeEventsRequest>;

/** Sacar evidencias a un evento nuevo (dos sucesos distintos que se unieron por error). */
export const SplitEventRequest = z.object({
  evidenceIds: z.array(z.uuid()).min(1).max(200),
  reason: ModeratorReason,
});
export type SplitEventRequest = z.infer<typeof SplitEventRequest>;

export const RevertMergeRequest = z.object({ reason: ModeratorReason });
export type RevertMergeRequest = z.infer<typeof RevertMergeRequest>;

/** Evidencia vista por moderación: sin la identidad de quien reportó. */
export interface ModeratorEvidenceView {
  id: string;
  evidenceType: EvidenceType;
  trustTier: "CITIZEN" | "EXTERNAL" | "OFFICIAL";
  assertion: "OCCURRING" | "NOT_OCCURRING";
  presenceBand: string | null;
  matchConfidence: string;
  observedAt: string;
}

export interface EventMergeView {
  id: string;
  targetEventId: string;
  mergedEventId: string;
  reason: string;
  movedEvidence: number;
  at: string;
  revertedAt: string | null;
}

/**
 * Una fuente externa u oficial que respalda un evento (Blueprint §9.3, §10.4; ADR 0055): quién lo publicó, con qué
 * licencia y el enlace al original. Nunca incluye reportes ciudadanos (esos son seudónimos o personas).
 */
export interface EventSourceView {
  sourceKey: string;
  sourceName: string;
  trustTier: "EXTERNAL" | "OFFICIAL";
  license: string | null;
  termsUrl: string | null;
  /** Enlace al ítem original (solo https). */
  link: string | null;
  title: Record<string, string> | null;
  publishedAt: string | null;
  /** NOT_OCCURRING: la fuente desmiente o retiró el suceso. */
  assertion: "OCCURRING" | "NOT_OCCURRING";
}

export interface EventStatusChangeView {
  from: EventStatus;
  to: EventStatus;
  reason: string;
  at: string;
}

/** Par de EVENTs que quizá son el mismo suceso, para revisión (ADR 0076). */
export interface DuplicateCandidateView {
  id: string;
  score: number;
  /** AMBIGUOUS_SCORE: coincidencia en la franja ambigua; BOTH_SOURCED: ambos tienen fuentes externas u oficiales. */
  reason: "AMBIGUOUS_SCORE" | "BOTH_SOURCED";
  createdAt: string;
  events: [EventSummary, EventSummary];
}

export const DismissDuplicateRequest = z.object({ reason: z.string().trim().min(3).max(2000) });
export type DismissDuplicateRequest = z.infer<typeof DismissDuplicateRequest>;

export interface ModeratorEventDetail {
  eventId: string;
  status: EventStatus;
  mergedIntoId: string | null;
  evidence: ModeratorEvidenceView[];
  merges: EventMergeView[];
  statusChanges: EventStatusChangeView[];
  /** Notas de moderación en la línea de tiempo (ADR 0147): visibles solo para moderación, las más recientes primero. */
  notes: ModeratorNoteView[];
  /** Gravedad vigente, la corrección de moderación si la hay y sus cambios auditados (ADR 0160). */
  severity: number;
  severityOverride: number | null;
  severityChanges: EventSeverityChangeView[];
  /** Sensibilidad vigente y sus subidas por contexto (ADR 0179). */
  sensitivity: Sensitivity;
  sensitivityChanges: { from: Sensitivity; to: Sensitivity; reason: string; at: string }[];
}
export interface EventSeverityChangeView { from: number; to: number; override: number | null; reason: string; at: string }
export interface ModeratorNoteView { id: string; text: string; byUserId: string | null; at: string }
export const AddModeratorNoteRequest = z.object({ text: z.string().trim().min(3).max(2000) });
export type AddModeratorNoteRequest = z.infer<typeof AddModeratorNoteRequest>;

/** Cambio manual del ciclo de vida (ADR 0053): siempre con motivo; reactivar reinicia el reloj de inactividad. */
export const SetEventStatusRequest = z.object({
  to: EventStatus,
  reason: z.string().trim().min(3).max(2000),
});
export type SetEventStatusRequest = z.infer<typeof SetEventStatusRequest>;

/** Corrección de gravedad por moderación (ADR 0160). `severity: null` la quita y vuelve a mandar la evidencia. */
export const SetEventSeverityRequest = z.object({
  severity: z.number().int().min(1).max(5).nullable(),
  reason: z.string().trim().min(3).max(2000),
});
export type SetEventSeverityRequest = z.infer<typeof SetEventSeverityRequest>;

/** Subir la sensibilidad de un evento por su contexto (ADR 0179): nunca se baja. */
export const RaiseEventSensitivityRequest = z.object({
  to: z.enum(["SENSITIVE", "HIGHLY_SENSITIVE"]),
  reason: z.string().trim().min(3).max(2000),
});
export type RaiseEventSensitivityRequest = z.infer<typeof RaiseEventSensitivityRequest>;
export const SENSITIVITY_ORDER = ["NORMAL", "SENSITIVE", "HIGHLY_SENSITIVE"] as const;
