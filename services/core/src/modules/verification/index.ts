import {
  VERIFICATION_LEVEL_RANK,
  publicVerificationState,
  type NegativeState,
  type VerificationExplanation,
  type VerificationLevel,
  type VerificationView,
} from "@dizaster/contracts";
import type { Db, Queryable } from "../../platform/db.js";
import { withTransaction } from "../../platform/db.js";
import { DomainError, notFound } from "../../platform/errors.js";
import { newId } from "../../platform/ids.js";
import { publish, type OutboxDispatcher } from "../../platform/outbox.js";
import type { EvidenceForVerification, EventService } from "../event/index.js";
import type { IdentityService } from "../identity/index.js";
import type { IngestionService } from "../ingestion/index.js";
import type { ReferenceData } from "../reference/index.js";

export const VERIFICATION_RULES_VERSION = "verification-1";

/** Parámetros anti-abuso de la versión de reglas. */
const RULES = {
  /** Cuentas con menos horas que esto cuentan la mitad (granjas de cuentas nuevas). */
  newAccountHours: 24,
  newAccountWeight: 0.5,
  /** DISPUTED: al menos este peso de contra-reportes independientes con presencia alta... */
  disputeMinDeniers: 2,
  /** ...y que representen al menos esta fracción del peso de quienes confirman. */
  disputeRatio: 0.5,
  /** Se levanta DISPUTED cuando las confirmaciones superan en este factor a las negaciones. */
  undisputeFactor: 2,
};

interface StateRow { level: VerificationLevel; negative_state: NegativeState }

interface Computation {
  level: VerificationLevel;
  negative: NegativeState;
  explanation: VerificationExplanation[];
  officialConfirmIds: string[];
  officialDenyIds: string[];
  ruleId: string;
  summary: { citizen: number; external: number; official: number };
}

/**
 * Verification Engine: independiente del Event Engine (se comunican por eventos de dominio).
 * - Nivel positivo monótono: UNVERIFIED → COMMUNITY → EXTERNALLY → OFFICIALLY_CONFIRMED.
 * - Estados negativos: DISPUTED (reglas, reversible) y FALSE (solo fuente oficial o moderación con motivo y evidencia).
 * - La IA solo deja sugerencias en ai_suggestions; ninguna regla las lee.
 */
export class VerificationService {
  constructor(
    private readonly db: Db,
    private readonly ref: ReferenceData,
    private readonly events: EventService,
    private readonly ingestion: IngestionService,
    private readonly identity: IdentityService,
  ) {}

  registerHandlers(dispatcher: OutboxDispatcher): void {
    dispatcher.on("EventCreated", "verification.init", async (e, tx) => {
      await tx.query(
        `INSERT INTO verification.state (event_id, level, negative_state, rule_set_version) VALUES ($1, 'UNVERIFIED', 'NONE', $2)
         ON CONFLICT DO NOTHING`,
        [e.payload.eventId, VERIFICATION_RULES_VERSION],
      );
    });
    dispatcher.on("EventEvidenceAdded", "verification.evaluate", async (e, tx) => {
      await this.evaluate(tx, e.payload.eventId);
    });
  }

  async evaluate(tx: Queryable, eventId: string): Promise<void> {
    await tx.query(
      `INSERT INTO verification.state (event_id, level, negative_state, rule_set_version) VALUES ($1, 'UNVERIFIED', 'NONE', $2) ON CONFLICT DO NOTHING`,
      [eventId, VERIFICATION_RULES_VERSION],
    );
    const current = (await tx.query<StateRow>(`SELECT level, negative_state FROM verification.state WHERE event_id = $1 FOR UPDATE`, [eventId])).rows[0]!;
    const c = await this.compute(tx, eventId, current);

    const levelChanged = c.level !== current.level;
    const negativeChanged = c.negative !== current.negative_state;
    await tx.query(
      `UPDATE verification.state SET level = $2, negative_state = $3, rule_set_version = $4, explanation = $5, evaluated_at = now() WHERE event_id = $1`,
      [eventId, c.level, c.negative, VERIFICATION_RULES_VERSION, JSON.stringify(c.explanation)],
    );
    if (!levelChanged && !negativeChanged) return;

    const official = (levelChanged && c.level === "OFFICIALLY_CONFIRMED") || (negativeChanged && c.negative === "FALSE");
    const evidenceIds = c.negative === "FALSE" && negativeChanged ? c.officialDenyIds : official ? c.officialConfirmIds : [];
    await tx.query(
      `INSERT INTO verification.transitions (id, event_id, from_level, to_level, from_negative, to_negative, cause, rule_id, evidence_ids, actor, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'system', $10)`,
      [
        newId(), eventId, current.level, c.level, current.negative_state, c.negative, official ? "OFFICIAL_SOURCE" : "RULE", c.ruleId, evidenceIds,
        c.negative === "FALSE" && negativeChanged ? "Desmentido por una fuente oficial registrada" : null,
      ],
    );
    await publish(tx, "VerificationChanged", { eventId, from: current.level, to: c.level, negativeState: c.negative }, { lane: official ? "urgent" : "interactive" });
  }

  private async compute(tx: Queryable, eventId: string, current: StateRow): Promise<Computation> {
    const data = await this.events.evidenceForVerification(tx, eventId);
    const category = this.ref.category(data.categoryCode, data.countryCode);
    const threshold = category?.communityThreshold ?? 3;
    const explanation: VerificationExplanation[] = [];

    // Evidencia externa/oficial: se valida contra el registro de fuentes, no contra lo que diga la fila.
    const nonCitizen = data.evidence.filter((e) => e.evidenceType === "EXTERNAL_ITEM" || e.evidenceType === "OFFICIAL_ITEM");
    const registered = await this.ingestion.registeredItems(tx, nonCitizen.map((e) => e.refId));
    const officialConfirm = nonCitizen.filter((e) => registered.get(e.refId)?.trustTier === "OFFICIAL" && e.assertion === "OCCURRING");
    const officialDeny = nonCitizen.filter((e) => registered.get(e.refId)?.trustTier === "OFFICIAL" && e.assertion === "NOT_OCCURRING");
    const external = nonCitizen.filter((e) => registered.get(e.refId)?.trustTier === "EXTERNAL" && e.assertion === "OCCURRING");

    const confirmWeight = await this.independentWeight(tx, data.evidence.filter((e) => e.trustTier === "CITIZEN" && e.assertion === "OCCURRING"));
    const denyWeight = await this.independentWeight(tx, data.evidence.filter((e) => e.trustTier === "CITIZEN" && e.assertion === "NOT_OCCURRING"));

    let computed: VerificationLevel = "UNVERIFIED";
    let ruleId = "none";
    if (confirmWeight >= threshold) {
      computed = "COMMUNITY_CORROBORATED";
      ruleId = "community-threshold";
    }
    if (external.length > 0) {
      computed = "EXTERNALLY_CORROBORATED";
      ruleId = "external-source-match";
    }
    if (officialConfirm.length > 0) {
      computed = "OFFICIALLY_CONFIRMED";
      ruleId = "official-source-match";
    }
    // Monotonía: el nivel positivo no baja solo; los problemas se expresan con estados negativos.
    const level = VERIFICATION_LEVEL_RANK[computed] > VERIFICATION_LEVEL_RANK[current.level] ? computed : current.level;

    let negative: NegativeState = current.negative_state;
    if (officialDeny.length > 0) {
      negative = "FALSE";
      ruleId = "official-denial";
    } else if (current.negative_state === "FALSE") {
      negative = "FALSE"; // solo moderación puede revertir un FALSE
    } else if (officialConfirm.length > 0) {
      negative = "NONE"; // una confirmación oficial prevalece sobre una disputa ciudadana
    } else if (denyWeight >= RULES.disputeMinDeniers && denyWeight >= RULES.disputeRatio * confirmWeight) {
      negative = "DISPUTED";
      ruleId = "citizen-dispute";
    } else if (current.negative_state === "DISPUTED" && confirmWeight >= RULES.undisputeFactor * denyWeight) {
      negative = "NONE";
      ruleId = "dispute-resolved";
    }

    explanation.push({ code: "CITIZEN_CORROBORATION", params: { independentWeight: confirmWeight, threshold } });
    if (denyWeight > 0) explanation.push({ code: "CITIZEN_DENIALS", params: { independentWeight: denyWeight } });
    if (external.length) explanation.push({ code: "EXTERNAL_SOURCES", params: { count: external.length } });
    if (officialConfirm.length) explanation.push({ code: "OFFICIAL_CONFIRMATION", params: { count: officialConfirm.length } });
    if (officialDeny.length) explanation.push({ code: "OFFICIAL_DENIAL", params: { count: officialDeny.length } });

    return {
      level,
      negative,
      explanation,
      officialConfirmIds: officialConfirm.map((e) => e.id),
      officialDenyIds: officialDeny.map((e) => e.id),
      ruleId,
      summary: {
        citizen: data.evidence.filter((e) => e.trustTier === "CITIZEN").length,
        external: external.length,
        official: officialConfirm.length + officialDeny.length,
      },
    };
  }

  /**
   * Peso de corroboración INDEPENDIENTE: solo presencia HIGH, una vez por persona y una vez por dispositivo
   * (dos cuentas en el mismo teléfono cuentan como una), y las cuentas nuevas pesan la mitad.
   */
  private async independentWeight(tx: Queryable, evidence: EvidenceForVerification[]): Promise<number> {
    const high = evidence.filter((e) => e.presenceBand === "HIGH" && e.contributorUserId);
    const seenUsers = new Set<string>();
    const seenDevices = new Set<string>();
    const counted: string[] = [];
    for (const e of high) {
      if (seenUsers.has(e.contributorUserId!)) continue;
      if (e.contributorDeviceId && seenDevices.has(e.contributorDeviceId)) continue;
      seenUsers.add(e.contributorUserId!);
      if (e.contributorDeviceId) seenDevices.add(e.contributorDeviceId);
      counted.push(e.contributorUserId!);
    }
    const ages = await this.identity.accountAgeHours(tx, counted);
    return counted.reduce((sum, u) => sum + ((ages.get(u) ?? 0) < RULES.newAccountHours ? RULES.newAccountWeight : 1), 0);
  }

  /**
   * Moderación: marcar/retirar estados negativos. Controles: motivo obligatorio, evidencia obligatoria para FALSE,
   * auditoría inmutable, y un evento confirmado oficialmente no puede declararse FALSE por moderación
   * (solo un desmentido oficial registrado puede hacerlo).
   */
  async moderatorSetNegative(input: { eventId: string; moderatorUserId: string; to: NegativeState; reason: string; evidenceRefs: string[] }): Promise<void> {
    if (input.reason.trim().length < 10) throw new DomainError("REASON_REQUIRED", "El motivo debe tener al menos 10 caracteres");
    if (input.to === "FALSE" && input.evidenceRefs.length === 0) throw new DomainError("EVIDENCE_REQUIRED", "Declarar FALSE exige evidencia");
    await withTransaction(this.db, async (tx) => {
      const current = (await tx.query<StateRow>(`SELECT level, negative_state FROM verification.state WHERE event_id = $1 FOR UPDATE`, [input.eventId])).rows[0];
      if (!current) throw notFound("Evento");
      if (input.to === "FALSE" && current.level === "OFFICIALLY_CONFIRMED") {
        throw new DomainError("CONFLICT_WITH_OFFICIAL", "Un evento confirmado oficialmente solo puede desmentirse con una fuente oficial registrada", 409);
      }
      if (current.negative_state === input.to) return;
      await tx.query(`UPDATE verification.state SET negative_state = $2, evaluated_at = now() WHERE event_id = $1`, [input.eventId, input.to]);
      await tx.query(
        `INSERT INTO verification.transitions (id, event_id, from_level, to_level, from_negative, to_negative, cause, evidence_ids, actor, reason)
         VALUES ($1, $2, $3, $3, $4, $5, 'MODERATOR', $6, $7, $8)`,
        [newId(), input.eventId, current.level, current.negative_state, input.to, input.evidenceRefs, `moderator:${input.moderatorUserId}`, input.reason],
      );
      await publish(tx, "VerificationChanged", { eventId: input.eventId, from: current.level, to: current.level, negativeState: input.to });
    });
  }

  /** La IA puede sugerir; la sugerencia se guarda y NO cambia ningún estado. */
  async recordAiSuggestion(input: { eventId: string; task: string; suggestedLevel?: VerificationLevel; suggestedNegative?: NegativeState; rationale: string; provider: string; model: string }): Promise<void> {
    if (input.suggestedLevel === "OFFICIALLY_CONFIRMED") {
      throw new DomainError("AI_CANNOT_CONFIRM", "La IA no puede proponer OFFICIALLY_CONFIRMED");
    }
    await this.db.query(
      `INSERT INTO verification.ai_suggestions (id, event_id, task, suggested_level, suggested_negative, rationale, provider, model)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [newId(), input.eventId, input.task, input.suggestedLevel ?? null, input.suggestedNegative ?? null, input.rationale, input.provider, input.model],
    );
  }

  async view(q: Queryable, eventId: string): Promise<VerificationView> {
    const row = (await q.query<{ level: VerificationLevel; negative_state: NegativeState; rule_set_version: string; evaluated_at: Date; explanation: VerificationExplanation[] }>(
      `SELECT level, negative_state, rule_set_version, evaluated_at, explanation FROM verification.state WHERE event_id = $1`,
      [eventId],
    )).rows[0];
    if (!row) throw notFound("Verificación");
    const data = await this.events.evidenceForVerification(q, eventId);
    const registered = await this.ingestion.registeredItems(q, data.evidence.filter((e) => e.trustTier !== "CITIZEN").map((e) => e.refId));
    return {
      eventId,
      level: row.level,
      negativeState: row.negative_state,
      publicState: publicVerificationState(row.level, row.negative_state),
      ruleSetVersion: row.rule_set_version,
      evaluatedAt: row.evaluated_at.toISOString(),
      explanation: row.explanation,
      evidenceSummary: {
        citizen: data.evidence.filter((e) => e.trustTier === "CITIZEN").length,
        external: [...registered.values()].filter((r) => r.trustTier === "EXTERNAL").length,
        official: [...registered.values()].filter((r) => r.trustTier === "OFFICIAL").length,
      },
    };
  }
}
