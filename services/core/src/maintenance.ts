import type { Container } from "./container.js";

/** Una tarea de mantenimiento: nombre para el registro y lo que hace (devuelve lo que se registra). */
export type Job = readonly [name: string, run: () => Promise<unknown>];

/**
 * Tareas aisladas (ADR 0243): cada una con su propio try/catch. Un fallo (p. ej. el almacenamiento de media caído)
 * se registra y las demás siguen; antes cortaba la cadena y saltaba la privacidad de presencia por un día entero.
 */
export async function runJobs(jobs: readonly Job[], log: (msg: string, data: Record<string, unknown>) => void, warn: (msg: string, e: unknown) => void): Promise<{ failed: string[] }> {
  const failed: string[] = [];
  for (const [name, run] of jobs) {
    try {
      const out = await run();
      if (out !== undefined) log(name, typeof out === "object" && out !== null ? (out as Record<string, unknown>) : { result: out });
    } catch (e) {
      failed.push(name);
      warn(`${name}.failed`, e);
    }
  }
  return { failed };
}

/** Cada hora: ciclo de vida, fin oficial, archivo, degradación por costo, prioridades y duplicados. */
export function hourlyJobs(c: Container): Job[] {
  return [
    ["events.lifecycle", () => c.events.applyLifecycle(c.db, c.clock.now())],
    ["events.source-end", async () => ({ resolved: await c.events.applySourceEnd(c.db, await c.ingestion.endedItems(c.db, c.clock.now())) })],
    ["events.archive", async () => ({ archived: await c.events.archiveResolved(c.db, c.clock.now()) })],
    ["cost.degradation", async () => {
      const d = await c.cost.applyDegradation();
      if (d.changed.length) console.warn(JSON.stringify({ msg: "cost.degradation.applied", ...d }));
      return undefined;
    }],
    ["moderation.priorities", () => c.moderation.refreshPriorities()],
    ["events.duplicates", () => c.events.sweepDuplicates(c.db, c.clock.now())],
  ];
}

/** Cada día: retención y privacidad. La generalización de presencia va primero (plazo de privacidad, §13.2 / D-06). */
export function dailyJobs(c: Container): Job[] {
  return [
    ["retention.presence.generalized", async () => ({ count: await c.reports.generalizeExpiredPresence() })],
    ["retention.presence.legacy-fixes", async () => { await c.reports.encryptLegacyFixes(); return undefined; }],
    ["retention.identity", () => c.identity.applyRetention(c.db, c.clock.now())],
    ["retention.alerts", () => c.alerts.applyRetention(c.env.NOTIFICATION_RETENTION_DAYS)],
    ["retention.cost", () => c.cost.applyRetention()],
    ["retention.media", () => c.media.applyRetention()],
    ["retention.source-raw", () => c.ingestionScheduler.applyRawRetention()],
    ["trust.standing.refresh", () => c.trust.refreshStanding()],
    ["retention.outbox", async () => ({ deleted: await c.dispatcher.purgeProcessed(c.env.OUTBOX_RETENTION_DAYS) })],
    ["retention.heartbeats", async () => ({ deleted: await c.heartbeat.prune() })],
    ["retention.client_crashes", async () => ({ deleted: await c.crashes.applyRetention(c.env.CLIENT_CRASH_RETENTION_DAYS) })],
  ];
}
