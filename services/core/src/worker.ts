import { buildContainer } from "./container.js";
import { loadEnv } from "./platform/config.js";

/**
 * Worker: procesa el outbox por carriles (urgent primero) y tareas periódicas baratas.
 * En V1 corre como un proceso aparte del mismo código; se escala horizontalmente sin cambios (SKIP LOCKED).
 */
const env = loadEnv();
const c = buildContainer(env);
let stopping = false;
let lastDaily = 0;
let lastHourly = 0;
let lastIngestionTick = 0;
let lastMeterFlush = Date.now();
let lastOpsCheck = 0;

async function loop() {
  while (!stopping) {
    const n = await c.dispatcher.runOnce(200);
    c.meter.add("outbox", "events", n);
    // Entrega de alertas: barata (una consulta indexada) y justo después de procesar eventos de dominio.
    const pushed = await c.alerts.flush();
    for (const [status, count] of Object.entries(pushed)) c.meter.add("alert", "notifications", count, status);
    c.meter.add("push", "messages", pushed.SENT + pushed.GROUPED);
    if (pushed.SENT + pushed.GROUPED + pushed.FAILED > 0) console.log(JSON.stringify({ msg: "alerts.flush", ...pushed }));
    if (Date.now() - lastIngestionTick > 30_000) {
      lastIngestionTick = Date.now();
      const published = await c.events.publishDue(c.db, c.clock.now());
      if (published > 0) console.log(JSON.stringify({ msg: "events.delayed.published", count: published }));
      for (const run of await c.ingestionScheduler.tick()) {
        c.meter.add("ingestion", "fetches", 1, run.sourceKey);
        c.meter.add("ingestion", "items_new", run.itemsNew, run.sourceKey);
        console.log(JSON.stringify({ msg: "ingestion.run", ...run }));
      }
    }
    // Alertas operativas (ADR 0130): SLO y cola de eventos; avisa solo al cambiar de estado.
    if (Date.now() - lastOpsCheck > 5 * 60_000) {
      lastOpsCheck = Date.now();
      const changed = await c.quality.checkOperational().catch((e: Error) => { console.warn(JSON.stringify({ msg: "ops.check", error: e.message })); return []; });
      for (const t of changed) console.warn(JSON.stringify({ msg: "ops.alert", ...t }));
    }
    if (Date.now() - lastHourly > 3600_000) {
      lastHourly = Date.now();
      console.log(JSON.stringify({ msg: "events.lifecycle", ...(await c.events.applyLifecycle(c.db, c.clock.now())) }));
      const ended = await c.events.applySourceEnd(c.db, await c.ingestion.endedItems(c.db, c.clock.now()));
      console.log(JSON.stringify({ msg: "events.source-end", resolved: ended }));
      console.log(JSON.stringify({ msg: "events.archive", archived: await c.events.archiveResolved(c.db, c.clock.now()) }));
      // Degradación automática por costo fuera de IA (ADR 0138).
      const degradation = await c.cost.applyDegradation().catch((e: Error) => { console.warn(JSON.stringify({ msg: "cost.degradation", error: e.message })); return null; });
      if (degradation?.changed.length) console.warn(JSON.stringify({ msg: "cost.degradation.applied", ...degradation }));
      console.log(JSON.stringify({ msg: "events.duplicates", ...(await c.events.sweepDuplicates(c.db, c.clock.now())) }));
    }
    if (Date.now() - lastMeterFlush > 60_000) {
      lastMeterFlush = Date.now();
      await c.meter.flush(c.cost).catch((e: Error) => console.warn(JSON.stringify({ msg: "meter.flush", error: e.message })));
    }
    if (Date.now() - lastDaily > 24 * 3600_000) {
      lastDaily = Date.now();
      console.log(JSON.stringify({ msg: "retention.cost", ...(await c.cost.applyRetention()) }));
      const generalized = await c.reports.generalizeExpiredPresence();
      await c.reports.encryptLegacyFixes();
      console.log(JSON.stringify({ msg: "retention.presence.generalized", count: generalized }));
      const media = await c.media.applyRetention();
      console.log(JSON.stringify({ msg: "retention.media", ...media }));
      console.log(JSON.stringify({ msg: "retention.source-raw", ...(await c.ingestionScheduler.applyRawRetention()) }));
      console.log(JSON.stringify({ msg: "trust.standing.refresh", ...(await c.trust.refreshStanding()) }));
    }
    if (n === 0) await new Promise((r) => setTimeout(r, 1000));
  }
  await c.meter.flush(c.cost).catch(() => undefined);
  await c.db.end();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => (stopping = true));
await c.ingestion.syncRegistry(c.ref.sources);
await loop();
