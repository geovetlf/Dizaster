import { buildContainer } from "./container.js";
import { loadEnv } from "./platform/config.js";

/**
 * Tablero de calidad en la terminal (el mismo que GET /v1/admin/quality).
 *   node dist/quality-report-cli.js [días=7] [--json]
 */
const args = process.argv.slice(2);
const days = Number(args.find((a) => /^\d+$/.test(a)) ?? 7);
const c = buildContainer(loadEnv());
try {
  const r = await c.quality.report({ days });
  if (args.includes("--json")) {
    console.log(JSON.stringify(r, null, 2));
  } else {
    const v = (n: number | null, unit = "") => (n === null ? "—" : `${n}${unit}`);
    console.log(`Calidad ${r.period.from} → ${r.period.to} (${r.period.days} días)`);
    console.table(r.slos.map((s) => ({ objetivo: s.key, meta: `≤ ${s.target} ${s.unit}`, observado: v(s.observed, ` ${s.unit}`), estado: s.ok === null ? "sin datos" : s.ok ? "OK" : "FUERA" })));
    console.log(`API: ${r.api.requests} peticiones · p50 ${v(r.api.p50Ms, " ms")} · p95 ${v(r.api.p95Ms, " ms")} · p99 ${v(r.api.p99Ms, " ms")}`);
    console.log(`EVENTs: ${r.events.created} creados · ${r.events.merged} fusionados (${v(r.events.mergeRate)})`);
    const ve = r.verification;
    console.log(`Verificación: comunidad ${ve.communityCorroborated} · externa ${ve.externallyCorroborated} · oficial ${ve.officiallyConfirmed} · disputados ${ve.disputed} · falsos ${ve.markedFalse} · mediana a corroborar ${v(ve.medianMinutesToCorroboration, " min")}`);
    console.log(`Alertas: ${r.alerts.alerts} (${r.alerts.critical} críticas) · push p50 ${v(r.alerts.pushP50Seconds, " s")} · p95 ${v(r.alerts.pushP95Seconds, " s")} · crítico p95 ${v(r.alerts.criticalPushP95Seconds, " s")}`);
    console.log(`  Avisos: ${JSON.stringify(r.alerts.notifications)}`);
    console.log(`Ingesta: ${r.ingestion.runs} corridas · ${r.ingestion.failedRuns} fallidas · urgentes ${r.ingestion.urgentItems} · demora p95 ${v(r.ingestion.urgentLagP95Seconds, " s")}`);
    const m = r.moderation;
    console.log(`Moderación: ${m.openCases} abiertos (más antiguo ${v(m.oldestOpenHours, " h")}) · ${m.resolvedCases} resueltos (mediana ${v(m.medianResolutionHours, " h")}) · apelaciones ${m.appealsDecided} (${m.appealsReversed} revertidas)`);
  }
} finally {
  await c.db.end();
}
