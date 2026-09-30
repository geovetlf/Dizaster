import { buildContainer } from "./container.js";
import { loadEnv } from "./platform/config.js";
import { parseWorkerRoles, ROLE_LANES, type WorkerRole } from "./worker-roles.js";

/**
 * Worker por roles (ADR 0159): cada rol corre en su propio bucle, así un sondeo lento de una fuente normal o una
 * retención diaria nunca retrasan un aviso. `WORKER_ROLES` elige los roles de este proceso (por defecto, todos);
 * varias réplicas pueden repartirse los roles o repetirlos (el outbox y los avisos usan SKIP LOCKED).
 */
const env = loadEnv();
const c = buildContainer(env);
const roles = parseWorkerRoles(env.WORKER_ROLES);
let stopping = false;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (msg: string, data: Record<string, unknown> = {}) => console.log(JSON.stringify({ msg, ...data }));
const warn = (msg: string, e: unknown) => console.warn(JSON.stringify({ msg, error: e instanceof Error ? e.message : String(e) }));

/** Un error en una vuelta se registra y el bucle sigue: un rol nunca muere por un fallo puntual. */
async function forever(role: WorkerRole, step: () => Promise<number>): Promise<void> {
  while (!stopping) {
    let work = 0;
    try {
      work = await step();
    } catch (e) {
      warn(`worker.${role}.error`, e);
      await sleep(5000);
    }
    if (work === 0) await sleep(1000);
  }
}

async function runIngestion(lane: "URGENT" | "NORMAL"): Promise<void> {
  for (const run of await c.ingestionScheduler.tick([lane])) {
    c.meter.add("ingestion", "fetches", 1, run.sourceKey);
    c.meter.add("ingestion", "items_new", run.itemsNew, run.sourceKey);
    log("ingestion.run", { ...run });
  }
}

function urgentLoop(): Promise<void> {
  let lastTick = 0;
  return forever("urgent", async () => {
    const n = await c.dispatcher.runOnce(200, ROLE_LANES.urgent);
    c.meter.add("outbox", "events", n);
    // Entrega de alertas: barata (una consulta indexada) y justo después de procesar eventos de dominio.
    const pushed = await c.alerts.flush();
    for (const [status, count] of Object.entries(pushed)) c.meter.add("alert", "notifications", count, status);
    c.meter.add("push", "messages", pushed.SENT + pushed.GROUPED);
    if (pushed.SENT + pushed.GROUPED + pushed.FAILED > 0) log("alerts.flush", pushed);
    // Cada fuente respeta su propio intervalo urgente; aquí solo se mira con frecuencia quién toca.
    if (Date.now() - lastTick > 5_000) {
      lastTick = Date.now();
      const published = await c.events.publishDue(c.db, c.clock.now());
      if (published > 0) log("events.delayed.published", { count: published });
      await runIngestion("URGENT");
    }
    return n;
  });
}

function normalLoop(): Promise<void> {
  let lastTick = 0;
  return forever("normal", async () => {
    const n = await c.dispatcher.runOnce(200, ROLE_LANES.normal);
    c.meter.add("outbox", "events", n);
    if (Date.now() - lastTick > 30_000) {
      lastTick = Date.now();
      await runIngestion("NORMAL");
    }
    return n;
  });
}

function maintenanceLoop(): Promise<void> {
  let lastDaily = 0;
  let lastHourly = 0;
  let lastOpsCheck = 0;
  return forever("maintenance", async () => {
    // Alertas operativas (ADR 0130): SLO y cola de eventos; avisa solo al cambiar de estado.
    if (Date.now() - lastOpsCheck > 5 * 60_000) {
      lastOpsCheck = Date.now();
      const changed = await c.quality.checkOperational().catch((e: Error) => { warn("ops.check", e); return []; });
      for (const t of changed) console.warn(JSON.stringify({ msg: "ops.alert", ...t }));
    }
    if (Date.now() - lastHourly > 3600_000) {
      lastHourly = Date.now();
      log("events.lifecycle", await c.events.applyLifecycle(c.db, c.clock.now()));
      const ended = await c.events.applySourceEnd(c.db, await c.ingestion.endedItems(c.db, c.clock.now()));
      log("events.source-end", { resolved: ended });
      log("events.archive", { archived: await c.events.archiveResolved(c.db, c.clock.now()) });
      // Degradación automática por costo fuera de IA (ADR 0138).
      const degradation = await c.cost.applyDegradation().catch((e: Error) => { warn("cost.degradation", e); return null; });
      if (degradation?.changed.length) console.warn(JSON.stringify({ msg: "cost.degradation.applied", ...degradation }));
      log("moderation.priorities", await c.moderation.refreshPriorities());
      log("events.duplicates", await c.events.sweepDuplicates(c.db, c.clock.now()));
    }
    if (Date.now() - lastDaily > 24 * 3600_000) {
      lastDaily = Date.now();
      log("retention.cost", await c.cost.applyRetention());
      const generalized = await c.reports.generalizeExpiredPresence();
      await c.reports.encryptLegacyFixes();
      log("retention.presence.generalized", { count: generalized });
      log("retention.media", await c.media.applyRetention());
      log("retention.source-raw", await c.ingestionScheduler.applyRawRetention());
      log("trust.standing.refresh", await c.trust.refreshStanding());
      log("retention.alerts", await c.alerts.applyRetention(c.env.NOTIFICATION_RETENTION_DAYS));
      log("retention.outbox", { deleted: await c.dispatcher.purgeProcessed(c.env.OUTBOX_RETENTION_DAYS) });
      log("retention.client_crashes", { deleted: await c.crashes.applyRetention(c.env.CLIENT_CRASH_RETENTION_DAYS) });
    }
    await sleep(5000);
    return 0;
  });
}

// El contador de uso se vuelca en todos los procesos (cada uno mide lo suyo).
async function meterLoop(): Promise<void> {
  let last = Date.now();
  while (!stopping) {
    await sleep(1000);
    if (Date.now() - last < 60_000) continue;
    last = Date.now();
    await c.meter.flush(c.cost).catch((e: Error) => warn("meter.flush", e));
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => (stopping = true));
await c.ingestion.syncRegistry(c.ref.sources);
log("worker.start", { roles });
const loops: Record<WorkerRole, () => Promise<void>> = { urgent: urgentLoop, normal: normalLoop, maintenance: maintenanceLoop };
await Promise.all([...roles.map((r) => loops[r]()), meterLoop()]);
await c.meter.flush(c.cost).catch(() => undefined);
await c.db.end();
