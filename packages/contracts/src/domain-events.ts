/**
 * Eventos de dominio publicados vía transactional outbox.
 * Los consumidores deben ser idempotentes. Añadir un tipo nuevo no rompe a los existentes.
 */
export const OUTBOX_LANES = ["urgent", "interactive", "normal", "batch"] as const;
export type OutboxLane = (typeof OUTBOX_LANES)[number];

export interface DomainEventMap {
  ReportSubmitted: { reportId: string; eventId: string | null; presenceBand: string; assertion: string };
  ReportDowngradedToPost: { postId: string; reasons: string[] };
  EventCreated: { eventId: string; categoryCode: string };
  EventEvidenceAdded: { eventId: string; evidenceId: string; evidenceType: string };
  EventMerged: { targetEventId: string; mergedEventId: string };
  VerificationChanged: { eventId: string; from: string; to: string; negativeState: string };
  EventLifecycleChanged: { eventId: string; to: "ACTIVE" | "MONITORING" | "RESOLVED" };
  /** Hay notificaciones nuevas por entregar (despierta al emisor push sin esperar al siguiente ciclo). */
  AlertTriggered: { alertId: string; eventId: string; kind: string };
  ExternalItemIngested: { externalItemId: string; sourceId: string; lane: "NORMAL" | "URGENT" };
  MediaUploaded: { mediaId: string };
  MediaReady: { mediaId: string };
  MediaRejected: { mediaId: string; reason: string };
  /** Acción de moderación aplicada (por regla o por una persona). */
  ModerationActionTaken: { actionId: string; targetType: string; targetId: string; action: string; actor: "RULE" | "MODERATOR" };
  /** Un presupuesto cruzó el 50, 80 o 100 % en su periodo. Al 100 % la función se degrada (CostGuard deniega). */
  BudgetThresholdReached: { key: string; threshold: 50 | 80 | 100; periodStart: string; spentUsd: number; limitUsd: number };
}
export type DomainEventType = keyof DomainEventMap;

export interface DomainEvent<T extends DomainEventType = DomainEventType> {
  id: string;
  type: T;
  version: number;
  payload: DomainEventMap[T];
  occurredAt: string;
  correlationId: string | null;
  lane: OutboxLane;
}
