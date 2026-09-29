import { buildContainer } from "./container.js";
import { loadEnv } from "./platform/config.js";

const STATUSES = ["ACTIVE", "PAUSED", "PLANNED", "RESEARCH", "RETIRED"] as const;
type Status = (typeof STATUSES)[number];

/**
 * Cambia el estado de una fuente del registro (runbook `docs/runbooks/fuente-caida.md`, ADR 0127).
 *   node dist/source-status-cli.js <clave> ACTIVE|PAUSED|PLANNED|RESEARCH|RETIRED
 * Pausar no borra nada: sus elementos ya ingeridos siguen sosteniendo los eventos hasta que caduquen.
 */
const [key, status] = process.argv.slice(2);
if (!key || !STATUSES.includes(status as Status)) throw new Error(`Uso: source-status-cli <clave> ${STATUSES.join("|")}`);
const c = buildContainer(loadEnv());
try {
  const { rows } = await c.db.query<{ status: string }>(`SELECT status FROM ingestion.sources WHERE key = $1`, [key]);
  if (!rows[0]) throw new Error(`Fuente desconocida: ${key}`);
  await c.ingestion.setSourceStatus(key, status as Status);
  console.log(`${key}: ${rows[0].status} → ${status}`);
} finally {
  await c.db.end();
}
