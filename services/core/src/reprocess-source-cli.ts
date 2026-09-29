import { buildContainer } from "./container.js";
import { loadEnv } from "./platform/config.js";

/**
 * Re-procesa el crudo guardado de una fuente (ADR 0133; runbook `docs/runbooks/fuente-caida.md`).
 *   node dist/reprocess-source-cli.js <clave> [desde AAAA-MM-DD] [hasta AAAA-MM-DD]
 * Útil tras corregir el adapter o el mapa de categorías de la fuente. Idempotente: lo que no cambió no hace nada.
 */
const [key, from, to] = process.argv.slice(2);
const day = (v: string | undefined, end: boolean) => {
  if (!v) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`Fecha inválida: ${v}`);
  return new Date(`${v}T${end ? "23:59:59.999" : "00:00:00"}Z`);
};
if (!key) throw new Error("Uso: reprocess-source-cli <clave> [desde AAAA-MM-DD] [hasta AAAA-MM-DD]");
const c = buildContainer(loadEnv());
try {
  const r = await c.ingestionScheduler.reprocess(key, { ...(from ? { from: day(from, false)! } : {}), ...(to ? { to: day(to, true)! } : {}) });
  console.log(JSON.stringify({ msg: "ingestion.reprocess", ...r }));
} finally {
  await c.db.end();
}
