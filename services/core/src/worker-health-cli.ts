import { hostname } from "node:os";
import { createPool } from "./platform/db.js";
import { loadEnv } from "./platform/config.js";
import { HeartbeatService } from "./platform/heartbeat.js";
import { parseWorkerRoles } from "./worker-roles.js";

/**
 * Healthcheck del contenedor del worker (ADR 0187): sale con 0 si esta instancia latió en todos sus roles
 * dentro del plazo, 1 si no. Tras varios fallos Docker marca el contenedor "unhealthy" para el orquestador/monitor.
 */
const env = loadEnv();
const db = createPool(env.DATABASE_URL);
try {
  const ok = await new HeartbeatService(db, { staleSeconds: env.WORKER_HEARTBEAT_STALE_SECONDS, outboxMaxAgeSeconds: env.OUTBOX_READY_MAX_AGE_SECONDS })
    .instanceAlive(env.WORKER_INSTANCE_ID ?? hostname(), parseWorkerRoles(env.WORKER_ROLES));
  process.exitCode = ok ? 0 : 1;
} catch {
  process.exitCode = 1;
} finally {
  await db.end();
}
