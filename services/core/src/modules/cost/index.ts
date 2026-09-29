import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CostDashboardQuery,
  MEDIA_KILL_SWITCHES,
  UpdateBudgetRequest,
  UpdateKillSwitchRequest,
  type AiUsageView,
  type BudgetPeriod,
  type BudgetView,
  type CostDashboard,
  type CostModuleView,
  type KillSwitchView,
} from "@dizaster/contracts";
import { z } from "zod";
import type { Clock } from "../../platform/clock.js";
import type { CostGuard } from "../../platform/cost-guard.js";
import { withTransaction, type Db, type Queryable } from "../../platform/db.js";
import { DomainError } from "../../platform/errors.js";
import type { AiCallEntry, AiCallSink } from "../../platform/connectors/index.js";
import { newId } from "../../platform/ids.js";
import type { UsageEntry, UsageSink } from "../../platform/metrics.js";
import { publish, type OutboxDispatcher } from "../../platform/outbox.js";
import type { IdentityService } from "../identity/index.js";
import type { MediaService } from "../media/index.js";

interface Prices {
  version: string;
  storageGbMonthUsd: { media: number; database: number };
  unitPrices: Record<string, { usd: number }>;
  fixedMonthlyUsd: number | null;
}

const THRESHOLDS = [50, 80, 100] as const;
const KILL_CACHE_MS = 15_000;
/** Funciones con interruptor remoto (ADR 0019, 0064, 0082). */
export const KNOWN_KILL_SWITCHES = ["ai", "translation", "sms", MEDIA_KILL_SWITCHES.uploads, MEDIA_KILL_SWITCHES.video] as const;
const GB = 1024 ** 3;
/** Clave de presupuesto / funcionalidad: minúsculas, puntos y guiones ("ai", "sms", "translation"). */
const Key = z.string().min(2).max(40).regex(/^[a-z][a-z0-9.-]*$/);

/**
 * Cost Optimization Layer persistido (Blueprint §5.18): presupuestos por periodo con avisos al 50/80/100 %,
 * kill switches remotos, uso medido por módulo y el tablero "costo por 1.000 usuarios activos".
 */
export class CostService implements CostGuard, UsageSink, AiCallSink {
  readonly prices: Prices;
  private kills: { at: number; map: Map<string, boolean> } | null = null;

  constructor(
    private readonly db: Db,
    private readonly identity: IdentityService,
    private readonly media: MediaService,
    private readonly clock: Clock,
    dataDir: string,
  ) {
    this.prices = JSON.parse(readFileSync(join(dataDir, "cost/prices.json"), "utf8")) as Prices;
  }

  // ───────────── CostGuard ─────────────

  /** ¿Puede gastarse `usd` en `key`? Sin presupuesto definido, o con la función apagada, no se gasta. */
  async check(key: string, usd: number, q: Queryable = this.db): Promise<boolean> {
    if (await this.isKilled(key)) return false;
    const budget = await this.budget(q, key);
    if (!budget) return false;
    const spent = await this.spentInPeriod(q, key, budget.period);
    return spent + usd <= budget.limitUsd;
  }

  /** Registra un gasto real y avisa (outbox) la primera vez que el periodo cruza el 50, 80 o 100 %. */
  async record(key: string, usd: number, opts: { provider?: string; units?: number } = {}, q?: Queryable): Promise<void> {
    const run = async (tx: Queryable) => {
      const day = this.today();
      await tx.query(
        `INSERT INTO cost.spend_daily (day, key, provider, units, usd) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (day, key, provider) DO UPDATE SET units = cost.spend_daily.units + EXCLUDED.units, usd = cost.spend_daily.usd + EXCLUDED.usd`,
        [day, key, opts.provider ?? "", opts.units ?? 0, usd],
      );
      const budget = await this.budget(tx, key);
      if (!budget) return;
      const spent = await this.spentInPeriod(tx, key, budget.period);
      const periodStart = this.periodStart(budget.period);
      for (const threshold of THRESHOLDS) {
        const reached = budget.limitUsd > 0 ? spent >= (budget.limitUsd * threshold) / 100 : spent > 0 && threshold === 100;
        if (!reached) continue;
        const { rowCount } = await tx.query(
          `INSERT INTO cost.threshold_alerts (key, period_start, threshold) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [key, periodStart, threshold],
        );
        if (rowCount) await publish(tx, "BudgetThresholdReached", { key, threshold, periodStart, spentUsd: spent, limitUsd: budget.limitUsd }, { lane: "urgent" });
      }
    };
    if (q) await run(q);
    else await withTransaction(this.db, run);
  }

  async isKilled(feature: string): Promise<boolean> {
    const t = this.clock.now().getTime();
    if (!this.kills || t - this.kills.at > KILL_CACHE_MS) {
      const { rows } = await this.db.query<{ feature: string; killed: boolean }>(`SELECT feature, killed FROM cost.kill_switches`);
      this.kills = { at: t, map: new Map(rows.map((r) => [r.feature, r.killed])) };
    }
    return this.kills.map.get(feature) === true;
  }

  // ───────────── Medición ─────────────

  /** Al borrar una cuenta, sus llamadas a la IA quedan sin persona (el costo sigue contando). */
  registerHandlers(dispatcher: OutboxDispatcher): void {
    dispatcher.on("AccountDeleted", "cost.unlink-ai-calls", async (e, tx) => {
      await tx.query(`UPDATE cost.ai_calls SET actor_user_id = NULL WHERE actor_user_id = $1`, [e.payload.userId]);
    });
  }

  /** Una llamada del AI CORE (ADR 0110), sin contenido. */
  async recordAiCall(e: AiCallEntry): Promise<void> {
    await this.db.query(
      `INSERT INTO cost.ai_calls (id, capability, provider, model, status, fallback, latency_ms, input_tokens, output_tokens, estimated_usd, usd,
                                 subject_type, subject_id, actor_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [newId(), e.capability, e.provider, e.model, e.status, e.fallback, e.latencyMs, e.inputTokens, e.outputTokens, e.estimatedUsd, e.usd,
        e.subject?.type ?? null, e.subject?.id ?? null, e.actorUserId],
    );
  }

  /** Uso de IA agregado de un periodo (tablero). */
  async aiUsage(q: Queryable, fromDay: string, toDay: string): Promise<AiUsageView[]> {
    const { rows } = await q.query<{ capability: string; provider: string; model: string | null; calls: number; fallbacks: number; inp: string; out: string; usd: string; lat: string }>(
      `SELECT capability, provider, model, count(*)::int AS calls, count(*) FILTER (WHERE fallback)::int AS fallbacks,
              sum(input_tokens) AS inp, sum(output_tokens) AS out, sum(usd) AS usd, avg(latency_ms) AS lat
         FROM cost.ai_calls WHERE at >= $1::date AND at < $2::date + 1
        GROUP BY capability, provider, model ORDER BY sum(usd) DESC, count(*) DESC, capability`,
      [fromDay, toDay],
    );
    return rows.map((r) => ({
      capability: r.capability, provider: r.provider, model: r.model, calls: r.calls, fallbacks: r.fallbacks,
      inputTokens: Number(r.inp), outputTokens: Number(r.out), usd: round(Number(r.usd)), avgLatencyMs: Math.round(Number(r.lat)),
    }));
  }

  async persistUsage(entries: UsageEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await this.db.query(
      `INSERT INTO cost.usage_daily (day, module, metric, provider, units)
       SELECT * FROM unnest($1::date[], $2::text[], $3::text[], $4::text[], $5::float8[])
       ON CONFLICT (day, module, metric, provider) DO UPDATE SET units = cost.usage_daily.units + EXCLUDED.units`,
      [entries.map((e) => e.day), entries.map((e) => e.module), entries.map((e) => e.metric), entries.map((e) => e.provider), entries.map((e) => e.units)],
    );
  }

  /** Retención: el detalle diario se guarda 400 días (comparar con el mismo mes del año anterior). */
  async applyRetention(): Promise<{ usage: number; spend: number; aiCalls: number }> {
    const usage = await this.db.query(`DELETE FROM cost.usage_daily WHERE day < current_date - 400`);
    const spend = await this.db.query(`DELETE FROM cost.spend_daily WHERE day < current_date - 400`);
    // El detalle por llamada de IA se guarda 90 días; el gasto agregado sigue en spend_daily.
    const aiCalls = await this.db.query(`DELETE FROM cost.ai_calls WHERE at < now() - interval '90 days'`);
    return { usage: usage.rowCount ?? 0, spend: spend.rowCount ?? 0, aiCalls: aiCalls.rowCount ?? 0 };
  }

  // ───────────── Administración ─────────────

  async setBudget(rawKey: string, raw: unknown, by: string | null): Promise<BudgetView> {
    const key = parse(Key, rawKey);
    const b = parse(UpdateBudgetRequest, raw);
    await this.db.query(
      `INSERT INTO cost.budgets (key, period, limit_usd, updated_by) VALUES ($1, $2, $3, $4)
       ON CONFLICT (key) DO UPDATE SET period = EXCLUDED.period, limit_usd = EXCLUDED.limit_usd, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [key, b.period, b.limitUsd, by],
    );
    return (await this.budgets(this.db)).find((x) => x.key === key)!;
  }

  async setKillSwitch(rawFeature: string, raw: unknown, by: string | null): Promise<KillSwitchView> {
    const feature = parse(Key, rawFeature);
    const k = parse(UpdateKillSwitchRequest, raw);
    const { rows } = await this.db.query<{ feature: string; killed: boolean; reason: string | null; updated_at: Date }>(
      `INSERT INTO cost.kill_switches (feature, killed, reason, updated_by) VALUES ($1, $2, $3, $4)
       ON CONFLICT (feature) DO UPDATE SET killed = EXCLUDED.killed, reason = EXCLUDED.reason, updated_by = EXCLUDED.updated_by, updated_at = now()
       RETURNING feature, killed, reason, updated_at`,
      [feature, k.killed, k.reason ?? null, by],
    );
    this.kills = null;
    const r = rows[0]!;
    return { feature: r.feature, killed: r.killed, reason: r.reason, updatedAt: r.updated_at.toISOString() };
  }

  // ───────────── Tablero ─────────────

  async dashboard(rawQuery: unknown): Promise<CostDashboard> {
    const { days } = parse(CostDashboardQuery, rawQuery);
    const now = this.clock.now();
    const to = this.today();
    const from = new Date(Date.parse(`${to}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
    const fraction = days / 30;

    const usage = await this.db.query<{ day: string; module: string; metric: string; provider: string; units: number }>(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, module, metric, provider, units FROM cost.usage_daily WHERE day BETWEEN $1 AND $2`,
      [from, to],
    );
    const spend = await this.db.query<{ day: string; key: string; provider: string; units: number; usd: string }>(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, key, provider, units, usd FROM cost.spend_daily WHERE day BETWEEN $1 AND $2`,
      [from, to],
    );

    const modules = new Map<string, Map<string, { metric: string; provider: string; units: number; estimatedUsd: number | null }>>();
    const daily = new Map<string, { requests: number; estimatedUsd: number }>();
    for (let d = Date.parse(`${from}T00:00:00Z`); d <= Date.parse(`${to}T00:00:00Z`); d += 86_400_000) {
      daily.set(new Date(d).toISOString().slice(0, 10), { requests: 0, estimatedUsd: 0 });
    }
    const add = (module: string, metric: string, provider: string, units: number, usd: number | null, day: string) => {
      const m = modules.get(module) ?? new Map();
      modules.set(module, m);
      const k = `${metric}|${provider}`;
      const cur = m.get(k) ?? { metric, provider, units: 0, estimatedUsd: usd === null ? null : 0 };
      cur.units += units;
      if (usd !== null) cur.estimatedUsd = (cur.estimatedUsd ?? 0) + usd;
      m.set(k, cur);
      const dd = daily.get(day);
      if (dd) {
        if (usd) dd.estimatedUsd += usd;
        if (module === "http" && metric === "requests") dd.requests += units;
      }
    };
    for (const r of usage.rows) {
      const price = this.prices.unitPrices[`${r.module}.${r.metric}`];
      add(r.module, r.metric, r.provider, Number(r.units), price ? price.usd * Number(r.units) : null, r.day);
    }
    for (const r of spend.rows) add(r.key, "spend", r.provider, Number(r.units), Number(r.usd), r.day);

    const moduleViews: CostModuleView[] = [...modules.entries()]
      .map(([module, m]) => {
        const metrics = [...m.values()].map((x) => ({ ...x, estimatedUsd: x.estimatedUsd === null ? null : round(x.estimatedUsd) }))
          .sort((a, b) => a.metric.localeCompare(b.metric) || a.provider.localeCompare(b.provider));
        return { module, metrics, estimatedUsd: round(metrics.reduce((s, x) => s + (x.estimatedUsd ?? 0), 0)) };
      })
      .sort((a, b) => b.estimatedUsd - a.estimatedUsd || a.module.localeCompare(b.module));

    const databaseBytes = Number((await this.db.query<{ n: string }>(`SELECT pg_database_size(current_database()) AS n`)).rows[0]!.n);
    const mediaStoredBytes = await this.media.storedBytes(this.db);
    const variable = moduleViews.reduce((s, m) => s + m.estimatedUsd, 0);
    const storage = ((mediaStoredBytes / GB) * this.prices.storageGbMonthUsd.media + (databaseBytes / GB) * this.prices.storageGbMonthUsd.database) * fraction;
    const fixed = this.prices.fixedMonthlyUsd === null ? null : this.prices.fixedMonthlyUsd * fraction;
    const total = variable + storage + (fixed ?? 0);
    const activeUsers = await this.identity.activeUsers(this.db, new Date(`${from}T00:00:00Z`));

    return {
      period: { from, to, days },
      generatedAt: now.toISOString(),
      pricesVersion: this.prices.version,
      activeUsers,
      estimatedUsd: { variable: round(variable), storage: round(storage), fixed: fixed === null ? null : round(fixed), total: round(total) },
      costPer1000ActiveUsers: activeUsers > 0 ? round((total / activeUsers) * 1000) : null,
      gauges: { databaseBytes, mediaStoredBytes },
      modules: moduleViews,
      daily: [...daily.entries()].map(([day, v]) => ({ day, requests: v.requests, estimatedUsd: round(v.estimatedUsd) })),
      budgets: await this.budgets(this.db),
      killSwitches: await this.killSwitches(),
      ai: await this.aiUsage(this.db, from, to),
    };
  }

  async budgets(q: Queryable): Promise<BudgetView[]> {
    const { rows } = await q.query<{ key: string; period: BudgetPeriod; limit_usd: string }>(`SELECT key, period, limit_usd FROM cost.budgets ORDER BY key`);
    const out: BudgetView[] = [];
    for (const r of rows) {
      const limitUsd = Number(r.limit_usd);
      const spentUsd = await this.spentInPeriod(q, r.key, r.period);
      out.push({
        key: r.key, period: r.period, limitUsd, spentUsd: round(spentUsd),
        percent: limitUsd > 0 ? round((spentUsd / limitUsd) * 100, 1) : spentUsd > 0 ? 100 : null,
        killed: await this.isKilled(r.key),
      });
    }
    return out;
  }

  async killSwitches(): Promise<KillSwitchView[]> {
    const { rows } = await this.db.query<{ feature: string; killed: boolean; reason: string | null; updated_at: Date }>(
      `SELECT feature, killed, reason, updated_at FROM cost.kill_switches ORDER BY feature`,
    );
    const views: KillSwitchView[] = rows.map((r) => ({ feature: r.feature, killed: r.killed, reason: r.reason, updatedAt: r.updated_at.toISOString() }));
    // Los interruptores conocidos aparecen aunque nunca se hayan tocado, para poder apagarlos desde el tablero.
    for (const feature of KNOWN_KILL_SWITCHES) {
      if (!views.some((v) => v.feature === feature)) views.push({ feature, killed: false, reason: null, updatedAt: null });
    }
    return views.sort((a, b) => a.feature.localeCompare(b.feature));
  }

  private async budget(q: Queryable, key: string): Promise<{ period: BudgetPeriod; limitUsd: number } | null> {
    const { rows } = await q.query<{ period: BudgetPeriod; limit_usd: string }>(`SELECT period, limit_usd FROM cost.budgets WHERE key = $1`, [key]);
    return rows[0] ? { period: rows[0].period, limitUsd: Number(rows[0].limit_usd) } : null;
  }

  private async spentInPeriod(q: Queryable, key: string, period: BudgetPeriod): Promise<number> {
    const { rows } = await q.query<{ usd: string | null }>(`SELECT sum(usd) AS usd FROM cost.spend_daily WHERE key = $1 AND day >= $2`, [key, this.periodStart(period)]);
    return Number(rows[0]?.usd ?? 0);
  }

  private today(): string {
    return this.clock.now().toISOString().slice(0, 10);
  }

  /** Los periodos se cuentan en UTC: un solo reloj para todos los países. */
  private periodStart(period: BudgetPeriod): string {
    const d = this.today();
    return period === "DAILY" ? d : `${d.slice(0, 7)}-01`;
  }

  /** Unidades medidas por métrica de un módulo en un rango de días (para calidad: histograma de latencia). */
  async usageByMetric(q: Queryable, module: string, fromDay: string, toDay: string): Promise<Map<string, number>> {
    const { rows } = await q.query<{ metric: string; units: number }>(
      `SELECT metric, sum(units)::float8 AS units FROM cost.usage_daily WHERE module = $1 AND day BETWEEN $2 AND $3 GROUP BY metric`,
      [module, fromDay, toDay],
    );
    return new Map(rows.map((r) => [r.metric, Number(r.units)]));
  }
}

const round = (n: number, digits = 4) => Math.round(n * 10 ** digits) / 10 ** digits;

function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const r = schema.safeParse(value);
  if (!r.success) throw new DomainError("VALIDATION", r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data;
}
