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
  /** Límite general por persona (o por IP sin sesión), por minuto (ADR 0047). */
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_WRITES_PER_MINUTE: z.coerce.number().int().positive().default(60),
  /** Detrás de un CDN o balanceador: tomar la IP de X-Forwarded-For. Solo si ese proxy la fija. */
  TRUST_PROXY: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  PRESENCE_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  /** Claves de cifrado por columna (ADR 0048): "kid:base64(32 bytes)", separadas por comas; la primera cifra. */
  FIELD_KEYS: z.string().optional(),
  DATA_DIR: z.string().optional(),
  // Media. "local" solo fuera de producción; producción usa un almacenamiento compatible con S3.
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default(".data/storage"),
  /** URL con la que los dispositivos alcanzan esta API (para las rutas de almacenamiento local). */
  PUBLIC_API_URL: z.string().default("http://localhost:8080"),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  MEDIA_PUBLIC_BASE_URL: z.string().optional(),
  MEDIA_UPLOADS_PER_HOUR_LIMIT: z.coerce.number().int().positive().default(30),
  MEDIA_UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  MEDIA_ORIGINAL_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  // Push directo (gratis). "log" no envía nada (desarrollo); "live" usa APNs y FCM con las credenciales de abajo.
  PUSH_DRIVER: z.enum(["log", "live"]).default("log"),
  APNS_TEAM_ID: z.string().optional(),
  APNS_KEY_ID: z.string().optional(),
  /** Clave .p8 de APNs: el PEM tal cual o en base64. */
  APNS_PRIVATE_KEY: z.string().optional(),
  APNS_BUNDLE_ID: z.string().default("app.dizaster.mobile"),
  /** JSON de la cuenta de servicio de Firebase, tal cual o en base64. */
  FCM_SERVICE_ACCOUNT_JSON: z.string().optional(),
});

export type AppEnv = z.infer<typeof Env>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const env = Env.parse(source);
  if (env.NODE_ENV === "production" && env.DEV_AUTH_ENABLED) {
    throw new Error("DEV_AUTH_ENABLED no puede estar activo en producción");
  }
  if (env.NODE_ENV === "production" && env.STORAGE_DRIVER === "local") {
    throw new Error("El almacenamiento local no se permite en producción: usar STORAGE_DRIVER=s3");
  }
  if (env.STORAGE_DRIVER === "s3" && !(env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY)) {
    throw new Error("STORAGE_DRIVER=s3 requiere S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID y S3_SECRET_ACCESS_KEY");
  }
  if (env.NODE_ENV === "production" && !env.FIELD_KEYS) {
    throw new Error("Producción requiere FIELD_KEYS (cifrado de la ubicación precisa)");
  }
  if (env.NODE_ENV === "production" && env.PUSH_DRIVER !== "live") {
    throw new Error("Producción requiere PUSH_DRIVER=live (APNs y FCM)");
  }
  return env;
}

/** Acepta un secreto en claro o en base64 (cómodo para variables de entorno de una sola línea). */
export function decodeSecret(v: string): string {
  const t = v.trim();
  return t.startsWith("-----") || t.startsWith("{") ? t : Buffer.from(t, "base64").toString("utf8");
}
