import { QualityQuery, type QualityReport, type SloView } from "@dizaster/contracts";
import type { Clock } from "../../platform/clock.js";
import type { Db } from "../../platform/db.js";
import { DomainError } from "../../platform/errors.js";
import { histogramPercentile } from "../../platform/metrics.js";
import { opsAlertText, type AlertService, type OpsAlertKey } from "../alert/index.js";
import type { IdentityService } from "../identity/index.js";
import type { CostService } from "../cost/index.js";
import type { EventService } from "../event/index.js";
import type { IngestionService } from "../ingestion/index.js";
import type { ModerationService } from "../moderation/index.js";
import type { VerificationService } from "../verification/index.js";

/**
 * Objetivos de calidad (Blueprint RNF-01/02/03 y §14). Viven aquí y en el ADR 0026: cambiarlos es una decisión.
 * - API: p95 de las respuestas bajo 300 ms.
 * - Cadena urgente oficial: de que la fuente publica a que el push crítico sale, p95 bajo 120 s.
 * - Moderación: ningún caso abierto más de 24 h.
 */
export const SLO_TARGETS = { apiP95Ms: 300, urgentChainP95Seconds: 120, moderationOldestOpenHours: 24 } as const;

/** Alerta operativa extra (ADR 0130): un evento interno sin procesar más de 5 min indica worker caído o consumidor roto. */
export const OPS_TARGETS = { outboxOldestPendingSeconds: 300, outboxDead: 0 } as const;

export interface OpsTransition { key: OpsAlertKey; breached: boolean; observed: number; target: number; unit: string }

/**
 * Tablero de calidad del producto. Módulo sin datos propios: pide a cada módulo sus agregados por su interfaz
 * pública y los junta. Solo cifras agregadas: nada de personas ni ubicaciones.
 */
export class QualityService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly deps: {
      cost: CostService; events: EventService; verification: VerificationService; alerts: AlertService;
      ingestion: IngestionService; moderation: ModerationService;
      /** Para las alertas operativas (ADR 0130); opcional para no acoplar el tablero. */
      ops?: { identity: IdentityService; backlog: () => Promise<{ oldestPendingSeconds: number | null; dead?: number }> };
    },
  ) {}

  /**
   * Alertas operativas (Blueprint §5.22, ADR 0130): juzga los SLO del último día y la cola de eventos internos, y avisa
   * por push a administración y operación solo cuando un objetivo pasa de cumplido a incumplido o al revés (el estado
   * queda en `quality.ops_alert_state`). Sin datos no se juzga. Lo llama el worker cada 5 min. NO AI REQUIRED.
   */
  async checkOperational(): Promise<OpsTransition[]> {
    const ops = this.deps.ops;
    if (!ops) return [];
    const r = await this.report({ days: 1 });
    const observed: { key: OpsAlertKey; observed: number | null; target: number; unit: string }[] = r.slos.map((s) => ({ key: s.key, observed: s.observed, target: s.target, unit: s.unit }));
    const backlog = await ops.backlog();
    observed.push({ key: "outbox_oldest_pending", observed: backlog.oldestPendingSeconds ?? 0, target: OPS_TARGETS.outboxOldestPendingSeconds, unit: "s" });
    // Cualquier evento en cuarentena (ADR 0206) avisa: algo se perdió hasta que operación lo reprocese.
    if (backlog.dead !== undefined) observed.push({ key: "outbox_dead", observed: backlog.dead, target: OPS_TARGETS.outboxDead, unit: "" });

    const prior = new Map((await this.db.query<{ key: string; breached: boolean }>(`SELECT key, breached FROM quality.ops_alert_state`)).rows.map((x) => [x.key, x.breached]));
    const transitions: OpsTransition[] = [];
    for (const o of observed) {
      if (o.observed === null) continue;
      const breached = o.observed > o.target;
      // Lo nunca visto solo avisa si arranca incumplido; recuperarse de algo que no se avisó no es noticia.
      if ((prior.get(o.key) ?? false) !== breached) transitions.push({ key: o.key, breached, observed: o.observed, target: o.target, unit: o.unit });
      await this.db.query(
        `INSERT INTO quality.ops_alert_state (key, breached, observed, changed_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (key) DO UPDATE SET observed = $3,
           changed_at = CASE WHEN quality.ops_alert_state.breached = $2 THEN quality.ops_alert_state.changed_at ELSE now() END, breached = $2`,
        [o.key, breached, o.observed],
      );
    }
    if (transitions.length > 0) {
      const { identity } = ops;
      const to = [...new Set([...(await identity.usersWithRole(this.db, "admin")), ...(await identity.usersWithRole(this.db, "operator"))])];
      for (const t of transitions) {
        await this.deps.alerts.notifyAdmins(to, (lang) => opsAlertText(lang, t), "dizaster://admin-quality", `ops:${t.key}`);
      }
    }
    return transitions;
  }

  async report(rawQuery: unknown): Promise<QualityReport> {
    const parsed = QualityQuery.safeParse(rawQuery ?? {});
    if (!parsed.success) throw new DomainError("VALIDATION", "Consulta inválida", 400);
    const { days } = parsed.data;
    const now = this.clock.now();
    const toDay = now.toISOString().slice(0, 10);
    const from = new Date(Date.parse(`${toDay}T00:00:00Z`) - (days - 1) * 86_400_000);
    const fromDay = from.toISOString().slice(0, 10);
    const q = this.db;
    const { cost, events, verification, alerts, ingestion, moderation } = this.deps;

    const http = await cost.usageByMetric(q, "http", fromDay, toDay);
    const buckets = new Map([...http].filter(([m]) => m.startsWith("latency_")));
    const pct = (p: number) => histogramPercentile(buckets, p);
    const ev = await events.qualityStats(q, from, now);
    const ing = await ingestion.qualityStats(q, from, now);
    const al = await alerts.qualityStats(q, from, now);
    const mod = await moderation.qualityStats(q, from, now, now);
    const api = { requests: http.get("requests") ?? 0, p50Ms: finite(pct(0.5)), p95Ms: finite(pct(0.95)), p99Ms: finite(pct(0.99)) };
    const apiP95 = pct(0.95);

    // La cadena urgente se estima sumando sus tramos medidos por separado (sin cruzar datos entre módulos).
    const chain = ing.urgentLagP95Seconds !== null && al.criticalPushP95Seconds !== null ? ing.urgentLagP95Seconds + al.criticalPushP95Seconds : null;
    const slos: SloView[] = [
      slo("api_p95", SLO_TARGETS.apiP95Ms, apiP95 === null ? null : apiP95 === Number.POSITIVE_INFINITY ? 5001 : apiP95, "ms"),
      slo("urgent_chain_p95", SLO_TARGETS.urgentChainP95Seconds, chain, "s"),
      // Sin casos abiertos el objetivo se cumple (0 h).
      slo("moderation_oldest_open", SLO_TARGETS.moderationOldestOpenHours, mod.oldestOpenHours ?? 0, "h"),
    ];

    return {
      period: { from: fromDay, to: toDay, days },
      generatedAt: now.toISOString(),
      slos,
      api,
      events: {
        ...ev,
        mergeRate: ev.created > 0 ? Math.round((ev.merged / ev.created) * 1000) / 1000 : null,
        autoMergeRevertRate: ev.autoMerged > 0 ? Math.round((ev.autoMergeReverted / ev.autoMerged) * 1000) / 1000 : null,
      },
      verification: await verification.qualityStats(q, from, now),
      alerts: al,
      ingestion: ing,
      moderation: mod,
    };
  }
}

function slo(key: SloView["key"], target: number, observed: number | null, unit: SloView["unit"]): SloView {
  return { key, target, observed, unit, ok: observed === null ? null : observed <= target };
}

/** Por encima del último tramo no hay techo: se informa 5001 ms ("más de 5 s") para que el JSON siga siendo válido. */
function finite(v: number | null): number | null {
  return v === Number.POSITIVE_INFINITY ? 5001 : v;
}
