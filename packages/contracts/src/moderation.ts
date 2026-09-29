import { z } from "zod";

/**
 * Moderation Layer (Blueprint §5.21, §13.3): denuncias de usuarios, cola priorizada, acciones auditables,
 * apelaciones y bloqueo entre personas (exigido por las tiendas para contenido generado por usuarios).
 */
export const FlagTargetType = z.enum(["POST", "COMMENT", "EVENT", "PROFILE"]);
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
}

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
