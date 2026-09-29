import { buildContainer } from "./container.js";
import { loadEnv } from "./platform/config.js";

/**
 * Tablero de costo en la terminal (el mismo que GET /v1/admin/cost), para quien opera sin la app.
 *   node dist/cost-report-cli.js [días=30] [--json]
 */
const args = process.argv.slice(2);
const days = Number(args.find((a) => /^\d+$/.test(a)) ?? 30);
const c = buildContainer(loadEnv());
try {
  const d = await c.cost.dashboard({ days });
  if (args.includes("--json")) {
    console.log(JSON.stringify(d, null, 2));
  } else {
    const usd = (n: number | null) => (n === null ? "—" : `US$ ${n.toFixed(2)}`);
    const mb = (n: number) => `${(n / 1024 ** 2).toFixed(1)} MB`;
    console.log(`Costo estimado ${d.period.from} → ${d.period.to} (${d.period.days} días, precios ${d.pricesVersion})`);
    console.log(`  Variable ${usd(d.estimatedUsd.variable)} · Almacenamiento ${usd(d.estimatedUsd.storage)} · Fijo ${usd(d.estimatedUsd.fixed)} · Total ${usd(d.estimatedUsd.total)}`);
    console.log(`  Usuarios activos ${d.activeUsers} · Costo por 1.000 usuarios ${usd(d.costPer1000ActiveUsers)}`);
    console.log(`  Base de datos ${mb(d.gauges.databaseBytes)} · Media ${mb(d.gauges.mediaStoredBytes)}`);
    console.log("\nPor módulo");
    console.table(d.modules.flatMap((m) => m.metrics.map((x) => ({ módulo: m.module, métrica: x.metric, proveedor: x.provider, unidades: x.units, usd: x.estimatedUsd }))));
    console.log("Presupuestos");
    console.table(d.budgets.map((b) => ({ clave: b.key, periodo: b.period, tope: b.limitUsd, gastado: b.spentUsd, "%": b.percent, apagado: b.killed })));
  }
} finally {
  await c.db.end();
}
