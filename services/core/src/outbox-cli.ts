import { createPool } from "./platform/db.js";
import { loadEnv } from "./platform/config.js";
import { OutboxDispatcher } from "./platform/outbox.js";

/**
 * Cuarentena del outbox (ADR 0206). Uso:
 *   pnpm outbox dead              → lista los eventos en cuarentena (tipo, intentos, primera línea del error)
 *   pnpm outbox replay [id ...]   → los devuelve a la cola (sin ids, todos), después de corregir el consumidor
 */
const [cmd, ...ids] = process.argv.slice(2);
const env = loadEnv();
const db = createPool(env.DATABASE_URL);
try {
  const outbox = new OutboxDispatcher(db);
  if (cmd === "dead") {
    const b = await outbox.backlog();
    console.log(JSON.stringify({ dead: b.dead, events: await outbox.dead() }, null, 2));
  } else if (cmd === "replay") {
    console.log(JSON.stringify({ replayed: await outbox.replayDead(ids) }));
  } else {
    console.error("Uso: outbox dead | outbox replay [id ...]");
    process.exitCode = 2;
  }
} finally {
  await db.end();
}
