import { z } from "zod";
import { CategoryCode } from "./common.js";
import { GeoPoint } from "./geo.js";
import { PresenceBand, PresenceSignals } from "./presence.js";

/**
 * Qué afirma el reporte. NOT_OCCURRING ("aquí no pasa nada") alimenta el estado DISPUTED
 * y solo puede adjuntarse a un evento existente; nunca crea eventos.
 */
export const ReportAssertion = z.enum(["OCCURRING", "NOT_OCCURRING"]);
export type ReportAssertion = z.infer<typeof ReportAssertion>;

export const AnonymityMode = z.enum(["PUBLIC", "PSEUDONYMOUS"]);
export type AnonymityMode = z.infer<typeof AnonymityMode>;

export const SubmitReportRequest = z
  .object({
    clientReportId: z.uuid(),
    categoryCode: CategoryCode,
    assertion: ReportAssertion.default("OCCURRING"),
    text: z.string().max(2000).optional(),
    mediaIds: z.array(z.uuid()).max(10).default([]),
    pin: GeoPoint,
    presence: PresenceSignals,
    capturedAt: z.iso.datetime({ offset: true }),
    capturedOffline: z.boolean().default(false),
    anonymityMode: AnonymityMode.default("PUBLIC"),
    deviceId: z.uuid().optional(),
    /** El usuario eligió un evento cercano ("es este"). Obligatorio para NOT_OCCURRING. */
    targetEventId: z.uuid().optional(),
  })
  .refine((r) => r.assertion !== "NOT_OCCURRING" || r.targetEventId !== undefined, {
    message: "NOT_OCCURRING requiere targetEventId",
    path: ["targetEventId"],
  });
export type SubmitReportRequest = z.infer<typeof SubmitReportRequest>;

export const PresenceRejectionReason = z.enum([
  "OUT_OF_RADIUS",
  "LOW_ACCURACY",
  "STALE_FIX",
  "MOCK_LOCATION",
  "ATTESTATION_FAILED",
  "IMPLAUSIBLE_MOVEMENT",
  "CLOCK_SKEW",
  "LATE_OFFLINE_SUBMISSION",
  // La foto o el video que probaba la captura en la app fue rechazado al procesarse (ADR 0121).
  "MEDIA_REJECTED",
]);
export type PresenceRejectionReason = z.infer<typeof PresenceRejectionReason>;

export const ReportRejectionCode = z.enum(["INVALID_CATEGORY", "OFFICIAL_ONLY"]);
export type ReportRejectionCode = z.infer<typeof ReportRejectionCode>;

export const SubmitReportResponse = z.discriminatedUnion("outcome", [
  /** `publishAfter`: categoría con retraso de publicación (ADR 0099); hasta esa hora solo quien reporta ve su post. */
  z.object({ outcome: z.literal("ATTACHED_TO_EVENT"), reportId: z.uuid(), postId: z.uuid(), eventId: z.uuid(), presenceBand: PresenceBand, publishAfter: z.string().optional() }),
  z.object({ outcome: z.literal("CREATED_EVENT"), reportId: z.uuid(), postId: z.uuid(), eventId: z.uuid(), presenceBand: PresenceBand, publishAfter: z.string().optional() }),
  z.object({ outcome: z.literal("DOWNGRADED_TO_POST"), postId: z.uuid(), reasons: z.array(PresenceRejectionReason) }),
  /** `code` es estable (la app lo traduce); `reason` es el texto del servidor, en español. */
  z.object({ outcome: z.literal("REJECTED"), code: ReportRejectionCode, reason: z.string() }),
]);
export type SubmitReportResponse = z.infer<typeof SubmitReportResponse>;

/**
 * "Mis reportes" (ADR 0094): lo que pasó con cada reporte propio. Sin puntaje de presencia ni razones antiabuso.
 * `preciseLocationRemovesAt`: cuándo se borrará la ubicación precisa; `preciseLocationRemovedAt`: cuándo se borró.
 */
export interface MyReportView {
  id: string;
  postId: string | null;
  eventId: string | null;
  categoryCode: string;
  assertion: ReportAssertion;
  status: "ACCEPTED" | "DOWNGRADED" | "WITHDRAWN";
  capturedAt: string;
  receivedAt: string;
  capturedOffline: boolean;
  preciseLocationRemovesAt: string | null;
  preciseLocationRemovedAt: string | null;
  /** Veces que moderación consultó la presencia de este reporte (ADR 0089), sin decir quién. */
  presenceReviews: number;
}
