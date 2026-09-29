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

async function loop() {
  while (!stopping) {
    const n = await c.dispatcher.runOnce(200);
    if (Date.now() - lastIngestionTick > 30_000) {
      lastIngestionTick = Date.now();
      for (const run of await c.ingestionScheduler.tick()) console.log(JSON.stringify({ msg: "ingestion.run", ...run }));
    }
    if (Date.now() - lastHourly > 3600_000) {
      lastHourly = Date.now();
      console.log(JSON.stringify({ msg: "events.lifecycle", ...(await c.events.applyLifecycle(c.db, c.clock.now())) }));
    }
    if (Date.now() - lastDaily > 24 * 3600_000) {
      lastDaily = Date.now();
      const generalized = await c.reports.generalizeExpiredPresence();
      console.log(JSON.stringify({ msg: "retention.presence.generalized", count: generalized }));
      const media = await c.media.applyRetention();
      console.log(JSON.stringify({ msg: "retention.media", ...media }));
    }
    if (n === 0) await new Promise((r) => setTimeout(r, 1000));
  }
  await c.db.end();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => (stopping = true));
await c.ingestion.syncRegistry(c.ref.sources);
await loop();
