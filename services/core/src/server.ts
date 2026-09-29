import { buildContainer } from "./container.js";
import { buildApp } from "./http/app.js";
import { loadEnv } from "./platform/config.js";

const env = loadEnv();
const container = buildContainer(env);
const app = await buildApp(container);
await app.listen({ port: env.PORT, host: "0.0.0.0" });
// Uso medido: se vuelca cada minuto en lote (una fila por día, módulo y métrica).
const stopMeter = container.meter.autoFlush(container.cost, 60_000, (e) => app.log.warn({ err: e }, "meter.flush"));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void app.close().then(stopMeter).then(() => container.db.end()).then(() => process.exit(0));
  });
}
