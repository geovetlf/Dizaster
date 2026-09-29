import { buildContainer } from "./container.js";
import { loadEnv } from "./platform/config.js";

/**
 * Informe de transparencia agregado en la terminal (el mismo que GET /v1/admin/transparency, ADR 0135).
 *   node dist/transparency-report-cli.js [días=90]
 * Sale en JSON, listo para publicar: solo conteos, con las cifras entre 1 y 4 como "<5".
 */
const days = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 90);
const c = buildContainer(loadEnv());
try {
  console.log(JSON.stringify(await c.moderation.transparency({ days }, c.clock.now()), null, 2));
} finally {
  await c.db.end();
}
