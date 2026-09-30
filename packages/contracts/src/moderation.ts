import { z } from "zod";
import type { MediaView } from "./media.js";

/**
 * Moderation Layer (Blueprint §5.21, §13.3): denuncias de usuarios, cola priorizada, acciones auditables,
 * apelaciones y bloqueo entre personas (exigido por las tiendas para contenido generado por usuarios).
 */
export const FlagTargetType = z.enum(["POST", "COMMENT", "EVENT", "PROFILE", "BUSINESS"]);
export type FlagTargetType = z.infer<typeof FlagTargetType>;

/** Motivos: los de riesgo para personas pesan más en la prioridad de la cola. */
export const FlagReason = z.enum(["PRIVACY", "VIOLENCE", "ILLEGAL", "HARASSMENT", "FALSE_INFO", "SPAM", "OTHER"]);
export type FlagReason = z.infer<typeof FlagReason>;

export const CreateFlagRequest = z.object({
  targetType: FlagTargetType,
  /** Id del post, comentario o evento; handle en el caso de un perfil. */
  targetId: z.string().min(1).max(64),
  reason: FlagReason,
  note: z.string().max(500).optional(),
});
export type CreateFlagRequest = z.infer<typeof CreateFlagRequest>;

export const ModerationActionType = z.enum([
  "HIDE", "REMOVE", "RESTORE", "LIMIT", "WARN_USER", "SUSPEND_USER", "UNSUSPEND_USER", "MARK_DISPUTED", "DISMISS",
  // Media de un post (ADR 0035): aprobar la que espera revisión (categorías sensibles) y marcarla como impactante.
  "APPROVE_MEDIA", "MARK_GRAPHIC",
  // Quitar la foto de un perfil o el logo de un negocio (ADR 0119) sin tocar la cuenta ni sus posts.
  "REMOVE_AVATAR",
  // Vaciar la bio y volver el nombre visible al handle (ADR 0263): doxxing o insultos en el perfil.
  "CLEAR_PROFILE_TEXT",
]);
export type ModerationActionType = z.infer<typeof ModerationActionType>;

export const TakeActionRequest = z.object({
  action: ModerationActionType,
  /** Obligatorio y visible para la persona afectada (transparencia). */
  reason: z.string().trim().min(10).max(1000),
});
export type TakeActionRequest = z.infer<typeof TakeActionRequest>;

export type CaseStatus = "OPEN" | "RESOLVED" | "DISMISSED";

export interface ModerationTargetPreview {
  type: FlagTargetType;
  id: string;
  /** Texto del post o comentario; nombre del perfil; título del evento. */
  text: string | null;
  /** Autoría: null si es seudónima (la moderación actúa sobre la cuenta sin verla). */
  authorHandle: string | null;
  state: string;
  categoryCode: string | null;
  /** Solo posts: su media tal como la vería moderación (incluida la que espera aprobación). */
  media?: MediaView[];
}

export interface CaseSummary {
  id: string;
  status: CaseStatus;
  priority: number;
  flagCount: number;
  reasons: Partial<Record<FlagReason, number>>;
  target: ModerationTargetPreview;
  openedAt: string;
  updatedAt: string;
  /** Quién lo está revisando (ADR 0134): solo si alguien lo tomó y no venció. Nunca se muestra quién es. */
  claim: { mine: boolean; until: string } | null;
}

/** Minutos que dura tomar un caso; se renuevan al volver a tomarlo (ADR 0134). */
export const CASE_CLAIM_MINUTES = 15;

export interface ModerationActionView {
  id: string;
  action: ModerationActionType;
  reason: string;
  /** RULE: automática (umbral de denuncias). MODERATOR: persona con rol. */
  actor: "RULE" | "MODERATOR";
  targetType: FlagTargetType;
  targetId: string;
  createdAt: string;
}

export interface CaseDetail extends CaseSummary {
  notes: { reason: FlagReason; note: string; createdAt: string }[];
  /** Solo POST: textos anteriores a cada edición (ADR 0136). Solo moderación los ve. */
  edits?: { previousText: string | null; editedAt: string }[];
  actions: ModerationActionView[];
}

export const CaseQueueQuery = z.object({
  status: z.enum(["OPEN", "RESOLVED", "DISMISSED"]).default("OPEN"),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(200).optional(),
});

export const AppealRequest = z.object({ text: z.string().trim().min(10).max(1000) });
export const DecideAppealRequest = z.object({ decision: z.enum(["UPHOLD", "REVERSE"]), reason: z.string().trim().min(10).max(1000) });

export type AppealStatus = "OPEN" | "UPHELD" | "REVERSED";

/** Lo que ve la persona afectada: qué se hizo, por qué y si puede apelar. */
export interface ModerationNotice {
  action: ModerationActionView;
  appeal: { id: string; status: AppealStatus; decisionReason: string | null } | null;
  canAppeal: boolean;
}

export interface AppealView {
  id: string;
  status: AppealStatus;
  text: string;
  createdAt: string;
  action: ModerationActionView;
  target: ModerationTargetPreview | null;
}

/** Ver la evidencia de presencia de un reporte (ADR 0089): motivo obligatorio, queda en auditoría. */
export const PresenceReviewRequest = z.object({
  reason: z.string().trim().min(10).max(500),
  caseId: z.uuid().optional(),
});
export type PresenceReviewRequest = z.infer<typeof PresenceReviewRequest>;

export interface PresenceReview {
  reportId: string;
  presenceBand: string;
  presenceScore: number;
  fixToPinM: number;
  mockLocation: boolean | null;
  attestationVerdict: "GENUINE" | "FAILED" | "UNAVAILABLE";
  reasons: string[];
  scoreBreakdown: Record<string, unknown>;
  ruleVersion: string;
  /** Ubicación precisa del teléfono al reportar; null si ya se generalizó (retención o cuenta borrada). */
  deviceFix: { lat: number; lng: number; accuracyM?: number; [k: string]: unknown } | null;
  preciseExpiresAt: string;
  generalizedAt: string | null;
  /** Veces que moderación ya la consultó (sin decir quién). */
  priorAccesses: number;
  /** Media de cámara del reporte y sus horas (ADR 0181). */
  mediaCaptureProofs: MediaCaptureProof[];
}

export interface MediaCaptureProof {
  mediaId: string;
  kind: string;
  capturedAt: string;
  /** Cuándo vio el servidor la subida. */
  serverSeenAt: string;
  /** Segundos entre la captura del medio y la del reporte (negativo: después). */
  secondsBeforeReport: number;
}

export interface PresenceAccessEntry {
  id: string;
  reportId: string;
  actorUserId: string;
  reason: string;
  caseId: string | null;
  preciseShown: boolean;
  accessedAt: string;
}

// ───────────── MFA TOTP del personal (ADR 0090) ─────────────
export interface MfaStatus {
  /** La cuenta tiene un autenticador confirmado. */
  enrolled: boolean;
  /** El servidor exige MFA a moderación y administración. */
  required: boolean;
  recoveryCodesLeft: number;
}
export interface MfaEnrollResponse { secret: string; otpauthUri: string }
export const MfaCodeRequest = z.object({ code: z.string().trim().regex(/^\d{6}$/) });
export type MfaCodeRequest = z.infer<typeof MfaCodeRequest>;
export const MfaVerifyRequest = z.union([
  z.object({ code: z.string().trim().regex(/^\d{6}$/) }),
  z.object({ recoveryCode: z.string().trim().min(8).max(12) }),
]);
export type MfaVerifyRequest = z.infer<typeof MfaVerifyRequest>;

/**
 * Informe de transparencia agregado (Blueprint §13.3, ADR 0135): solo conteos del periodo, sin personas ni objetos.
 * Una cifra entre 1 y 4 se informa como "<5" para que el informe se pueda publicar sin señalar casos concretos.
 */
export const TransparencyQuery = z.object({
  days: z.coerce.number().int().min(1).max(366).default(90),
});
export type TransparencyCount = number | "<5";
export interface TransparencyReport {
  period: { from: string; to: string; days: number };
  generatedAt: string;
  flags: { total: TransparencyCount; byReason: Partial<Record<FlagReason, TransparencyCount>> };
  cases: { opened: TransparencyCount; resolved: TransparencyCount; dismissed: TransparencyCount; medianHoursToClose: number | null };
  actions: { action: ModerationActionType; actor: "RULE" | "MODERATOR"; targetType: string; count: TransparencyCount }[];
  reversals: TransparencyCount;
  appeals: { received: TransparencyCount; upheld: TransparencyCount; reversed: TransparencyCount; open: TransparencyCount };
  /** Requerimientos de autoridades recibidos en el periodo, por tipo (ADR 0139). Solo conteos. */
  authorityRequests: { received: TransparencyCount; byType: Partial<Record<string, TransparencyCount>> };
}
export const TRANSPARENCY_MIN_COUNT = 5;
export const transparencyCount = (n: number): TransparencyCount => (n > 0 && n < TRANSPARENCY_MIN_COUNT ? "<5" : n);

/** Registro de acciones de moderación para administración (§5.21, §13.1, ADR 0239). Más recientes primero. */
export const ModerationActionsQuery = z.object({
  /** Handle de quien moderó; sin él, todas (automáticas incluidas). */
  moderator: z.string().trim().min(1).max(40).optional(),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ModerationActionsQuery = z.infer<typeof ModerationActionsQuery>;
export interface ModerationActionLogEntry extends ModerationActionView { moderatorHandle: string | null }
export interface ModerationActionsResponse { actions: ModerationActionLogEntry[]; nextCursor: string | null }
