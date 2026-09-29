import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(8080),
  DATABASE_URL: z.string().min(1),
  AUTH_JWT_SECRET: z.string().min(32),
  DEV_AUTH_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  MAP_PROVIDER_ID: z.string().default("maplibre-demo"),
  MAP_STYLE_URL_LIGHT: z.string().default("https://demotiles.maplibre.org/style.json"),
  MAP_STYLE_URL_DARK: z.string().default("https://demotiles.maplibre.org/style.json"),
  MAP_ATTRIBUTION: z.string().default("© OpenStreetMap contributors · MapLibre"),
  REPORTS_PER_HOUR_LIMIT: z.coerce.number().int().positive().default(10),
  PRESENCE_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  DATA_DIR: z.string().optional(),
});

export type AppEnv = z.infer<typeof Env>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const env = Env.parse(source);
  if (env.NODE_ENV === "production" && env.DEV_AUTH_ENABLED) {
    throw new Error("DEV_AUTH_ENABLED no puede estar activo en producción");
  }
  return env;
}
