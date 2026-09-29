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
import type { TrustService } from "../trust/index.js";
import type { IngestionService } from "../ingestion/index.js";
import type { ReferenceData } from "../reference/index.js";

export const VERIFICATION_RULES_VERSION = "verification-3";

/** Parámetros anti-abuso de la versión de reglas. El peso de cada persona lo da Trust (ADR 0023). */
const RULES = {
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
    private readonly trust: TrustService,
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
    const registered = await this.ingestion.registeredItems(tx, nonCitizen.map((e) => e.refId), { categoryCode: data.categoryCode, countryCode: data.countryCode });
    const officialConfirm = nonCitizen.filter((e) => registered.get(e.refId)?.trustTier === "OFFICIAL" && e.assertion === "OCCURRING");
    const officialDeny = nonCitizen.filter((e) => registered.get(e.refId)?.trustTier === "OFFICIAL" && e.assertion === "NOT_OCCURRING");
    const external = nonCitizen.filter((e) => registered.get(e.refId)?.trustTier === "EXTERNAL" && e.assertion === "OCCURRING");

    const windowMinutes = category?.dedupWindowMinutes ?? 360;
    const confirm = await this.independentWeight(tx, eventId, data.evidence.filter((e) => e.trustTier === "CITIZEN" && e.assertion === "OCCURRING"), windowMinutes);
    const deny = await this.independentWeight(tx, eventId, data.evidence.filter((e) => e.trustTier === "CITIZEN" && e.assertion === "NOT_OCCURRING"), windowMinutes);
    const confirmWeight = confirm.weight;
    const denyWeight = deny.weight;

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

    explanation.push({ code: "CITIZEN_CORROBORATION", params: { independentWeight: confirmWeight, threshold, ...(confirm.from && confirm.to ? { from: confirm.from, to: confirm.to } : {}) } });
    if (denyWeight > 0) explanation.push({ code: "CITIZEN_DENIALS", params: { independentWeight: denyWeight } });
    // Explicación legible completa (§10.4, ADR 0086): qué fuentes y a qué hora, y lo que todavía falta.
    const sources = (items: EvidenceForVerification[]) => sourceParams(items.map((e) => registered.get(e.refId)!));
    if (external.length) explanation.push({ code: "EXTERNAL_SOURCES", params: sources(external) });
    if (officialConfirm.length) explanation.push({ code: "OFFICIAL_CONFIRMATION", params: sources(officialConfirm) });
    if (officialDeny.length) explanation.push({ code: "OFFICIAL_DENIAL", params: sources(officialDeny) });

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
   * (dos cuentas en el mismo teléfono cuentan como una). Cada persona pesa según su reputación (nueva 0,5,
   * con mal historial 0,25, normal 1, de confianza 1,5) y un grupo coordinado cuenta como una sola. Quienes
   * escribieron exactamente el mismo texto (≥ 4 palabras, ADR 0074) también cuentan como una sola: pesa el mayor.
   * Solo cuentan juntos los reportes dentro de una ventana de tiempo coherente (la de deduplicación de la
   * categoría, ADR 0081): se toma la ventana con más peso. Devuelve también sus horas para la explicación.
   */
  private async independentWeight(
    tx: Queryable, eventId: string, evidence: EvidenceForVerification[], windowMinutes: number,
  ): Promise<WindowWeight> {
    const high = evidence.filter((e) => e.presenceBand === "HIGH" && e.contributorUserId);
    const weights = await this.trust.contributionWeights(tx, [...new Set(high.map((e) => e.contributorUserId!))], eventId);
    return bestWindowWeight(high, weights, windowMinutes * 60_000);
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
    const registered = await this.ingestion.registeredItems(q, data.evidence.filter((e) => e.trustTier !== "CITIZEN").map((e) => e.refId), { categoryCode: data.categoryCode, countryCode: data.countryCode });
    return {
      eventId,
      level: row.level,
      negativeState: row.negative_state,
      publicState: publicVerificationState(row.level, row.negative_state),
      ruleSetVersion: row.rule_set_version,
      evaluatedAt: row.evaluated_at.toISOString(),
      explanation: withStateLines(row.explanation, row.level, row.negative_state),
      evidenceSummary: {
        citizen: data.evidence.filter((e) => e.trustTier === "CITIZEN").length,
        external: [...registered.values()].filter((r) => r.trustTier === "EXTERNAL").length,
        official: [...registered.values()].filter((r) => r.trustTier === "OFFICIAL").length,
      },
    };
  }

  // ───────────── Calidad (ADR 0026) ─────────────

  /**
   * Cuántos EVENTs alcanzaron por primera vez cada estado en el periodo, y cuánto tardó la primera corroboración
   * desde que el EVENT existe. Un EVENT que baja y vuelve a subir no cuenta dos veces.
   */
  async qualityStats(q: Queryable, from: Date, to: Date) {
    const { rows } = await q.query<{ state: string; event_id: string; first_at: Date }>(
      `WITH firsts AS (
         SELECT to_level AS state, event_id, min(at) AS first_at FROM verification.transitions
          WHERE to_level <> 'UNVERIFIED' GROUP BY 1, 2
         UNION ALL
         SELECT to_negative AS state, event_id, min(at) FROM verification.transitions
          WHERE to_negative <> 'NONE' GROUP BY 1, 2
       )
       SELECT state, event_id, first_at FROM firsts WHERE first_at >= $1 AND first_at < $2`,
      [from, to],
    );
    const count = (s: string) => rows.filter((r) => r.state === s).length;
    // Primera subida de nivel por EVENT (cualquier nivel positivo) dentro del periodo.
    const firstUp = new Map<string, Date>();
    for (const r of rows) {
      if (!["COMMUNITY_CORROBORATED", "EXTERNALLY_CORROBORATED", "OFFICIALLY_CONFIRMED"].includes(r.state)) continue;
      const cur = firstUp.get(r.event_id);
      if (!cur || r.first_at < cur) firstUp.set(r.event_id, r.first_at);
    }
    // Una subida anterior al periodo no es la primera: se descarta.
    const earlier = await q.query<{ event_id: string }>(
      `SELECT DISTINCT event_id FROM verification.transitions WHERE event_id = ANY($1) AND to_level <> 'UNVERIFIED' AND at < $2`,
      [[...firstUp.keys()], from],
    );
    for (const r of earlier.rows) firstUp.delete(r.event_id);
    const created = await this.events.createdAt(q, [...firstUp.keys()]);
    const minutes = [...firstUp.entries()].flatMap(([id, at]) => {
      const c = created.get(id);
      return c ? [Math.max(0, (at.getTime() - c.getTime()) / 60_000)] : [];
    });
    return {
      communityCorroborated: count("COMMUNITY_CORROBORATED"),
      externallyCorroborated: count("EXTERNALLY_CORROBORATED"),
      officiallyConfirmed: count("OFFICIALLY_CONFIRMED"),
      disputed: count("DISPUTED"),
      markedFalse: count("FALSE"),
      medianMinutesToCorroboration: median(minutes),
    };
  }
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.round((s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2) * 10) / 10;
}

/** Suma de pesos donde cada grupo de textos idénticos aporta solo su mayor peso (ADR 0074). NO AI REQUIRED. */
export function sameTextCountsOnce(counted: { userId: string; textHash: string | null }[], weights: Map<string, number>): number {
  const byText = new Map<string, number>();
  let sum = 0;
  for (const c of counted) {
    const w = weights.get(c.userId) ?? 0;
    if (!c.textHash) sum += w;
    else byText.set(c.textHash, Math.max(byText.get(c.textHash) ?? 0, w));
  }
  for (const w of byText.values()) sum += w;
  return sum;
}

export interface WindowWeight { weight: number; from: string | null; to: string | null }

/**
 * Mayor peso independiente dentro de cualquier ventana de `windowMs` (ADR 0081). Dentro de cada ventana: una vez
 * por persona y por dispositivo, y textos idénticos como uno. Tres reportes repartidos en varios días no suman
 * juntos. NO AI REQUIRED.
 */
export function bestWindowWeight(
  evidence: Pick<EvidenceForVerification, "contributorUserId" | "contributorDeviceId" | "textHash" | "observedAt">[],
  weights: Map<string, number>, windowMs: number,
): WindowWeight {
  // Primero, una vez por persona y por dispositivo en todo el evento (como antes); después, ventanas sobre eso.
  const seenUsers = new Set<string>();
  const seenDevices = new Set<string>();
  const unique = [...evidence].sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime()).filter((e) => {
    if (!e.contributorUserId || seenUsers.has(e.contributorUserId)) return false;
    if (e.contributorDeviceId && seenDevices.has(e.contributorDeviceId)) return false;
    seenUsers.add(e.contributorUserId);
    if (e.contributorDeviceId) seenDevices.add(e.contributorDeviceId);
    return true;
  });
  let best: WindowWeight = { weight: 0, from: null, to: null };
  for (let i = 0; i < unique.length; i++) {
    const start = unique[i]!.observedAt.getTime();
    const counted: { userId: string; textHash: string | null }[] = [];
    let last = start;
    for (let j = i; j < unique.length && unique[j]!.observedAt.getTime() - start <= windowMs; j++) {
      counted.push({ userId: unique[j]!.contributorUserId!, textHash: unique[j]!.textHash });
      last = unique[j]!.observedAt.getTime();
    }
    const weight = sameTextCountsOnce(counted, weights);
    if (weight > best.weight) best = { weight, from: new Date(start).toISOString(), to: new Date(last).toISOString() };
  }
  return best;
}

/**
 * Parámetros de una línea de fuentes: cuántas, sus nombres (sin repetir, hasta 3) y la hora más reciente.
 * NO AI REQUIRED.
 */
export function sourceParams(items: readonly { sourceName: string; at: Date }[]): Record<string, string | number> {
  const names = [...new Set(items.map((i) => i.sourceName))];
  const latest = items.reduce<Date | null>((m, i) => (!m || i.at > m ? i.at : m), null);
  return {
    count: items.length,
    sources: names.slice(0, 3).join(", ") + (names.length > 3 ? ` +${names.length - 3}` : ""),
    ...(latest ? { at: latest.toISOString() } : {}),
  };
}

/**
 * Líneas que dependen del estado actual y no de la evidencia (ADR 0086): se añaden al leer, así un cambio de
 * moderación se explica en el acto. NO AI REQUIRED.
 */
export function withStateLines(base: readonly VerificationExplanation[], level: VerificationLevel, negative: NegativeState): VerificationExplanation[] {
  const out = base.filter((e) => !STATE_CODES.has(e.code));
  const officialDenial = out.some((e) => e.code === "OFFICIAL_DENIAL");
  if (negative === "FALSE" && !officialDenial) out.push({ code: "MARKED_FALSE", params: {} });
  if (negative === "DISPUTED") out.push({ code: "DISPUTED", params: {} });
  if (level !== "OFFICIALLY_CONFIRMED" && negative !== "FALSE") out.push({ code: "NOT_OFFICIAL_YET", params: {} });
  return out;
}
const STATE_CODES = new Set(["MARKED_FALSE", "DISPUTED", "NOT_OFFICIAL_YET"]);
