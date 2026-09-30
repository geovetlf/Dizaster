import { loadEnv } from "./platform/config.js";

/**
 * Valida una configuración antes de desplegarla (Blueprint §20.8, ADR 0272): el mismo `loadEnv` que usa el servidor,
 * con sus reglas de producción. Lo llama `dzd config-check` en otro proceso. Nunca imprime valores, solo el motivo.
 */
try {
  const env = loadEnv();
  console.log(`configuración válida (${env.NODE_ENV})`);
} catch (e) {
  const issues = (e as { issues?: { path: (string | number)[]; message: string }[] }).issues;
  console.error(issues ? issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
}
