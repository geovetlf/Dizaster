import { withTransaction, type Db, type Queryable } from "../../platform/db.js";
import { publish, type OutboxDispatcher } from "../../platform/outbox.js";
import type { EventService } from "../event/index.js";
import type { IdentityService } from "../identity/index.js";
import { TIER_WEIGHT, TRUST, coordinatedWeights, reportQuota, tierFor, withPhone, type PhoneSignals, type ReputationSignals, type TrustTier } from "./rules.js";

export { PHONE_TAMPER_LIMIT, PHONE_TAMPER_REASONS, TIER_WEIGHT, TRUST, TRUST_RULES_VERSION, coordinatedWeights, reportQuota, tierFor, withPhone, type PhoneSignals, type ReputationSignals, type TrustTier } from "./rules.js";

/** Acciones de moderación que cuentan en contra de la reputación de la persona afectada. */
const SANCTIONS = new Set(["HIDE", "REMOVE", "SUSPEND_USER"]);
/** Niveles de verificación que cuentan como "el evento resultó cierto". */
const CONFIRMED_LEVELS = new Set(["COMMUNITY_CORROBORATED", "EXTERNALLY_CORROBORATED", "OFFICIALLY_CONFIRMED"]);

/**
 * Trust & Safety (Blueprint §5.x "Trust", §13.3): reputación por persona a partir de antigüedad, precisión
 * histórica de sus reportes y sanciones, y detección de grupos coordinados. Solo reacciona a eventos de dominio
 * (outbox) y guarda en su esquema; nunca se muestra como número a nadie.
 */
export class TrustService {
  constructor(
    private readonly db: Db,
    private readonly identity: IdentityService,
    private readonly events: EventService,
  ) {}

  registerHandlers(dispatcher: OutboxDispatcher): void {
    dispatcher.on("EventEvidenceAdded", "trust.record-contribution", async (e, tx) => {
      const data = await this.events.evidenceForVerification(tx, e.payload.eventId);
      const added: string[] = [];
      for (const ev of data.evidence) {
        if (ev.trustTier !== "CITIZEN" || !ev.contributorUserId) continue;
        const r = await tx.query(
          `INSERT INTO trust.contributions (user_id, event_id, assertion, created_at) VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id, event_id) DO NOTHING`,
          [ev.contributorUserId, e.payload.eventId, ev.assertion, ev.observedAt],
        );
        if (r.rowCount) added.push(ev.contributorUserId);
      }
      // Un reporte que llega a un evento ya desmentido cuenta en ese momento.
      if (added.length > 0) await this.updateStanding(tx, added);
    });

    // Cómo terminó el evento decide si cada reporte fue acertado (también los que lleguen después).
    dispatcher.on("VerificationChanged", "trust.record-outcome", async (e, tx) => {
      const outcome = e.payload.negativeState === "FALSE" ? "FALSE" : CONFIRMED_LEVELS.has(e.payload.to) ? "CONFIRMED" : "PENDING";
      await tx.query(
        `INSERT INTO trust.event_outcomes (event_id, outcome) VALUES ($1, $2)
         ON CONFLICT (event_id) DO UPDATE SET outcome = $2, updated_at = now()`,
        [e.payload.eventId, outcome],
      );
      const { rows } = await tx.query<{ user_id: string }>(`SELECT user_id FROM trust.contributions WHERE event_id = $1`, [e.payload.eventId]);
      await this.updateStanding(tx, rows.map((r) => r.user_id));
    });

    // Retirar un reporte antes de que el evento se decida lo quita del historial; después, lo decidido se conserva.
    dispatcher.on("ReportWithdrawn", "trust.forget-withdrawn", async (e, tx) => {
      if (!e.payload.eventId) return;
      await tx.query(
        `DELETE FROM trust.contributions c WHERE c.user_id = $1 AND c.event_id = $2
            AND NOT EXISTS (SELECT 1 FROM trust.event_outcomes o WHERE o.event_id = c.event_id AND o.outcome IN ('CONFIRMED','FALSE'))`,
        [e.payload.userId, e.payload.eventId],
      );
    });
    dispatcher.on("ModerationActionTaken", "trust.record-sanction", async (e, tx) => {
      const p = e.payload;
      if (p.reverses) {
        const r = await tx.query<{ user_id: string }>(
          `UPDATE trust.sanctions SET reversed_at = now() WHERE action_id = $1 AND reversed_at IS NULL RETURNING user_id`, [p.reverses],
        );
        await this.updateStanding(tx, r.rows.map((x) => x.user_id));
      }
      if (p.actor !== "MODERATOR" || !p.affectedUserId || !SANCTIONS.has(p.action)) return;
      await tx.query(
        `INSERT INTO trust.sanctions (action_id, user_id, action) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [p.actionId, p.affectedUserId, p.action],
      );
      await this.updateStanding(tx, [p.affectedUserId]);
    });
  }

  /**
   * Proyección "reputación baja sí/no" (ADR 0031) para que el feed ordene sin leer este esquema. Solo publica
   * cuando cambia; quien nunca estuvo en LOW no ocupa fila.
   */
  async updateStanding(q: Queryable, userIds: string[]): Promise<number> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return 0;
    const tiers = await this.tiers(q, unique);
    const { rows } = await q.query<{ user_id: string; low: boolean }>(`SELECT user_id, low FROM trust.standing WHERE user_id = ANY($1)`, [unique]);
    const current = new Map(rows.map((r) => [r.user_id, r.low]));
    let changed = 0;
    for (const u of unique) {
      const low = tiers.get(u) === "LOW";
      if ((current.get(u) ?? false) === low) continue;
      await q.query(
        `INSERT INTO trust.standing (user_id, low) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET low = $2, updated_at = now()`,
        [u, low],
      );
      await publish(q, "AuthorStandingChanged", { userId: u, lowTrust: low });
      changed++;
    }
    return changed;
  }

  /** Tarea diaria: las sanciones caducan a los 90 días, así que quien está en LOW puede dejar de estarlo sin evento. */
  async refreshStanding(): Promise<{ checked: number; changed: number }> {
    return withTransaction(this.db, async (tx) => {
      const { rows } = await tx.query<{ user_id: string }>(`SELECT user_id FROM trust.standing WHERE low`);
      return { checked: rows.length, changed: await this.updateStanding(tx, rows.map((r) => r.user_id)) };
    });
  }

  async signals(q: Queryable, userIds: string[]): Promise<Map<string, ReputationSignals>> {
    if (userIds.length === 0) return new Map();
    const ages = await this.identity.accountAgeHours(q, userIds);
    const { rows } = await q.query<{ user_id: string; corroborated: number; false_reports: number; removals: number; suspensions: number }>(
      `SELECT u AS user_id,
              (SELECT count(*) FROM trust.contributions c JOIN trust.event_outcomes o ON o.event_id = c.event_id
                WHERE c.user_id = u AND ((o.outcome = 'CONFIRMED' AND c.assertion = 'OCCURRING')
                                      OR (o.outcome = 'FALSE' AND c.assertion = 'NOT_OCCURRING')))::int AS corroborated,
              (SELECT count(*) FROM trust.contributions c JOIN trust.event_outcomes o ON o.event_id = c.event_id
                WHERE c.user_id = u AND o.outcome = 'FALSE' AND c.assertion = 'OCCURRING')::int AS false_reports,
              (SELECT count(*) FROM trust.sanctions s WHERE s.user_id = u AND s.reversed_at IS NULL AND s.action <> 'SUSPEND_USER'
                  AND s.created_at > now() - make_interval(days => $2))::int AS removals,
              (SELECT count(*) FROM trust.sanctions s WHERE s.user_id = u AND s.reversed_at IS NULL AND s.action = 'SUSPEND_USER'
                  AND s.created_at > now() - make_interval(days => $2))::int AS suspensions
         FROM unnest($1::uuid[]) AS u`,
      [userIds, TRUST.sanctionWindowDays],
    );
    return new Map(rows.map((r) => [r.user_id, {
      accountAgeHours: ages.get(r.user_id) ?? 0, corroborated: r.corroborated, falseReports: r.false_reports,
      removals: r.removals, suspensions: r.suspensions,
    }]));
  }

  async tiers(q: Queryable, userIds: string[]): Promise<Map<string, TrustTier>> {
    const s = await this.signals(q, userIds);
    return new Map(userIds.map((u) => [u, tierFor(s.get(u) ?? { accountAgeHours: 0, corroborated: 0, falseReports: 0, removals: 0, suspensions: 0 })]));
  }

  /**
   * Peso de cada persona que aporta a un mismo EVENT: su reputación, y si varias forman un grupo coordinado
   * (cuentas jóvenes que ya co-reportaron en otros eventos recientes), el grupo cuenta como una.
   */
  async contributionWeights(q: Queryable, userIds: string[], eventId: string): Promise<Map<string, number>> {
    const tiers = await this.tiers(q, userIds);
    const weights = new Map(userIds.map((u) => [u, TIER_WEIGHT[tiers.get(u) ?? "NEW"]]));
    if (userIds.length < 2) return weights;
    const ages = await this.identity.accountAgeHours(q, userIds);
    const young = userIds.filter((u) => (ages.get(u) ?? 0) < TRUST.coordinationMaxAgeDays * 24);
    if (young.length < 2) return weights;
    const { rows } = await q.query<{ a: string; b: string }>(
      `SELECT c1.user_id AS a, c2.user_id AS b
         FROM trust.contributions c1
         JOIN trust.contributions c2 ON c2.event_id = c1.event_id AND c2.user_id > c1.user_id
        WHERE c1.user_id = ANY($1) AND c2.user_id = ANY($1) AND c1.event_id <> $2
          AND c1.created_at > now() - make_interval(days => $3)
        GROUP BY 1, 2 HAVING count(DISTINCT c1.event_id) >= $4`,
      [young, eventId, TRUST.coordinationWindowDays, TRUST.coordinationMinSharedEvents],
    );
    return coordinatedWeights(weights, rows.map((r) => [r.a, r.b]));
  }

  /** Reportes por hora permitidos a esta persona. */
  /** Bytes que la cuenta puede subir en 24 h (ADR 0072): misma escala que el cupo de reportes. */
  async uploadBytesQuota(q: Queryable, userId: string, baseMb: number): Promise<number> {
    return reportQuota((await this.tiers(q, [userId])).get(userId) ?? "NEW", baseMb) * 1024 * 1024;
  }

  /** Con `phone`, el cupo también refleja la reputación del teléfono (ADR 0131). */
  async reportQuota(q: Queryable, userId: string, base: number, phone: PhoneSignals | null = null): Promise<number> {
    return reportQuota(withPhone((await this.tiers(q, [userId])).get(userId) ?? "NEW", phone), base);
  }

  /** Peso de una denuncia (moderación): como al corroborar, pero nunca más de 1. */
  async flagWeight(q: Queryable, userId: string): Promise<number> {
    return Math.min(1, TIER_WEIGHT[(await this.tiers(q, [userId])).get(userId) ?? "NEW"]);
  }
}
