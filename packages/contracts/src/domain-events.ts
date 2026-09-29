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
  /** Un EVENT con retraso de publicación (ADR 0099) se hizo público. */
  EventPublished: { eventId: string };
  EventEvidenceAdded: { eventId: string; evidenceId: string; evidenceType: string };
  /** Un moderador unió un duplicado (ADR 0034). Los consumidores redirigen sus referencias al destino. */
  EventMerged: { mergeId: string; targetEventId: string; mergedEventId: string };
  /** Fusión revertida: las evidencias movidas (por su ref: reporte o ítem externo) vuelven al evento restaurado. */
  EventMergeReverted: { mergeId: string; targetEventId: string; restoredEventId: string; evidenceRefIds: string[] };
  /** Evidencias separadas a un evento nuevo. */
  EventSplit: { sourceEventId: string; newEventId: string; evidenceRefIds: string[] };
  VerificationChanged: { eventId: string; from: string; to: string; negativeState: string };
  EventLifecycleChanged: { eventId: string; to: "ACTIVE" | "MONITORING" | "RESOLVED" | "ARCHIVED" };
  /** Hay notificaciones nuevas por entregar (despierta al emisor push sin esperar al siguiente ciclo). */
  AlertTriggered: { alertId: string; eventId: string | null; kind: string };
  /**
   * Un post nuevo (o editado) mencionó a estas personas (ADR 0063). Solo las menciones recién enlazadas: editar un post
   * no vuelve a avisar a quien ya estaba mencionado. Ya excluye a quien bloqueó al autor.
   */
  UserMentioned: { postId: string; authorProfileId: string; profileIds: string[] };
  ExternalItemIngested: { externalItemId: string; sourceId: string; lane: "NORMAL" | "URGENT" };
  MediaUploaded: { mediaId: string };
  MediaReady: { mediaId: string; phash?: string | null };
  MediaRejected: { mediaId: string; reason: string };
  /** Quien reportó retiró su reporte (ADR 0037): su evidencia deja de contar y su post desaparece. */
  ReportWithdrawn: { reportId: string; userId: string; eventId: string | null };
  /** La persona borró su cuenta: cada módulo elimina o anonimiza lo suyo (ADR 0021). */
  AccountDeleted: { userId: string; profileId: string };
  /** Acción de moderación aplicada (por regla o por una persona). */
  /** Una foto casi idéntica (hash perceptual) a otra subida antes por otra persona: posible foto reciclada. */
  MediaReuseDetected: { mediaId: string };
  /** Media igual a contenido que moderación ya retiró (ADR 0145): queda oculta y va a la cola. */
  BlockedMediaMatched: { mediaId: string };
  /** Post con fotos o video en una categoría sensible: su media no se muestra hasta que moderación la apruebe (ADR 0035). */
  PostMediaNeedsReview: { postId: string };
  /** El mismo texto (normalizado) publicado por varias cuentas distintas en pocas horas: posible spam coordinado. */
  DuplicateTextDetected: { postIds: string[] };
  /** Texto con posibles datos personales (ADR 0088). Solo los tipos, nunca el dato. */
  PersonalDataDetected: { targetType: "POST" | "COMMENT"; targetId: string; kinds: string[] };
  /** La reputación de una persona entró o salió del nivel bajo (ADR 0031). Solo ordena el feed. */
  AuthorStandingChanged: { userId: string; lowTrust: boolean };
  ModerationActionTaken: {
    actionId: string; targetType: string; targetId: string; action: string; actor: "RULE" | "MODERATOR";
    /** Cuenta afectada (autoría del contenido o el perfil); null para acciones sobre un EVENT. */
    affectedUserId: string | null;
    /** Acción que esta revierte (apelación aceptada). */
    reverses: string | null;
  };
  /** Se decidió una apelación (ADR 0141): la persona recibe un aviso con el resultado. */
  AppealDecided: { appealId: string; appellantUserId: string; outcome: "UPHELD" | "REVERSED" };
  /** Un presupuesto cruzó el 50, 80 o 100 % en su periodo. Al 100 % la función se degrada (CostGuard deniega). */
  BudgetThresholdReached: { key: string; threshold: 50 | 80 | 100; periodStart: string; spentUsd: number; limitUsd: number };
  /** Una fuente con carril URGENT dejó de consultarse (breaker abierto) o volvió (ADR 0058). Nunca en silencio. */
  /** La degradación por costo apagó o devolvió una función (ADR 0138). */
  CostDegradationChanged: { budgetKey: string; feature: string; killed: boolean; percent: number };
  SourceHealthChanged: { sourceKey: string; state: "DEGRADED" | "RECOVERED"; failures: number; error: string | null; retryAt: string | null };
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
