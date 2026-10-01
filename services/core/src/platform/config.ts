import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(8080),
  DATABASE_URL: z.string().min(1),
  /** Roles de este proceso worker (ADR 0159): "urgent", "normal", "maintenance", separados por comas. */
  WORKER_ROLES: z.string().default("urgent,normal,maintenance"),
  AUTH_JWT_SECRET: z.string().min(32),
  // Inicio de sesión real (ADR 0170): client id de la app en cada proveedor, separados por comas. Vacío = apagado.
  AUTH_APPLE_AUDIENCES: z.string().default(""),
  AUTH_GOOGLE_AUDIENCES: z.string().default(""),
  /** Correo con código: "none" (apagado, hasta elegir proveedor) o "log" (solo desarrollo). */
  EMAIL_PROVIDER: z.enum(["none", "log"]).default("none"),
  DEV_AUTH_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  MAP_PROVIDER_ID: z.string().default("maplibre-demo"),
  MAP_STYLE_URL_LIGHT: z.string().default("https://demotiles.maplibre.org/style.json"),
  MAP_STYLE_URL_DARK: z.string().default("https://demotiles.maplibre.org/style.json"),
  MAP_ATTRIBUTION: z.string().default("© OpenStreetMap contributors · MapLibre"),
  /** D-ARCHIVE (ADR 0061): días que un evento RESOLVED sigue en el mapa antes de pasar a ARCHIVED. */
  EVENT_ARCHIVE_AFTER_DAYS: z.coerce.number().int().min(1).max(365).default(7),
  // Versión mínima de la app por plataforma y enlace a la tienda (ADR 0164). Vacío = sin mínimo / sin ficha aún.
  MIN_APP_VERSION_ANDROID: z.string().regex(/^(\d+(\.\d+)*)?$/).default(""),
  MIN_APP_VERSION_IOS: z.string().regex(/^(\d+(\.\d+)*)?$/).default(""),
  STORE_URL_ANDROID: z.string().default(""),
  STORE_URL_IOS: z.string().default(""),
  REPORTS_PER_HOUR_LIMIT: z.coerce.number().int().positive().default(10),
  /** Límite general por persona (o por IP sin sesión), por minuto (ADR 0047). */
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_WRITES_PER_MINUTE: z.coerce.number().int().positive().default(60),
  /**
   * Búsquedas por minuto y persona (o IP sin sesión), aparte del límite general (ADR 0291): son las lecturas más caras
   * y no piden sesión. La app lanza 6 por búsqueda tras 300 ms sin escribir; 120 da unas 20 búsquedas por minuto.
   */
  SEARCH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(120),
  /** Con más de una réplica de la API: contar el cupo por cuenta en PostgreSQL, compartido (ADR 0228). */
  RATE_LIMIT_SHARED: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  /** Detrás de un CDN o balanceador: tomar la IP de X-Forwarded-For. Solo si ese proxy la fija. */
  TRUST_PROXY: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  // Retención de datos operativos (ADR 0165).
  NOTIFICATION_RETENTION_DAYS: z.coerce.number().int().min(7).max(3650).default(90),
  OUTBOX_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(14),
  /** Plazo de una alerta sin `expires` de la fuente (ADR 0174). */
  ALERT_DEFAULT_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(24),
  /** Fallos de la app (ADR 0173). */
  CLIENT_CRASH_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  /** Decodificación aislada de media subida (ADR 0194). `inprocess` solo para desarrollo. */
  MEDIA_DECODER: z.enum(["isolated", "inprocess"]).default("isolated"),
  MEDIA_DECODE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300_000).default(30_000),
  MEDIA_DECODER_MAX_OLD_SPACE_MB: z.coerce.number().int().min(64).max(4096).default(256),
  /** Límites de base de datos y HTTP (ADR 0201). */
  DB_POOL_MAX: z.coerce.number().int().min(1).max(200).default(10),
  DB_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(5_000),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(30_000),
  DB_LOCK_TIMEOUT_MS: z.coerce.number().int().min(100).max(600_000).default(10_000),
  DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),
  /** Peticiones esperando conexión a partir de las cuales la API responde 503 al instante. */
  API_MAX_DB_WAITING: z.coerce.number().int().min(1).max(10_000).default(50),
  HTTP_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(30_000),
  // ADR 0205: plazos y cortocircuito para proveedores externos.
  PUSH_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(10_000),
  PUSH_BREAKER_THRESHOLD: z.coerce.number().int().min(1).max(100).default(5),
  PUSH_BREAKER_COOLDOWN_MS: z.coerce.number().int().min(1_000).max(600_000).default(30_000),
  STORAGE_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(900_000).default(120_000),
  /** Latido del worker y /health/ready (ADR 0187). */
  WORKER_INSTANCE_ID: z.string().min(1).max(100).optional(),
  WORKER_HEARTBEAT_STALE_SECONDS: z.coerce.number().int().min(30).max(3600).default(180),
  OUTBOX_READY_MAX_AGE_SECONDS: z.coerce.number().int().min(30).max(86400).default(300),
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
  /**
   * Cache-Control de las variantes públicas en el almacenamiento y la CDN (ADR 0286). Una hora por defecto: la
   * CDN absorbe las lecturas repetidas y una media retirada deja de servirse en, como mucho, ese plazo.
   */
  MEDIA_PUBLIC_CACHE_CONTROL: z.string().regex(/^(public|private)(, ?[a-z-]+(=\d+)?)*$/, "Cache-Control inválido").default("public, max-age=3600"),
  MEDIA_UPLOADS_PER_HOUR_LIMIT: z.coerce.number().int().positive().default(30),
  /** MB subidos en 24 h por cuenta con reputación normal; nueva: la mitad; baja: un cuarto (ADR 0072). */
  MEDIA_DAILY_UPLOAD_MB: z.coerce.number().int().min(60).default(300),
  /** Días que se guarda el crudo de cada fuente (ADR 0075); 0 = no se guarda. */
  SOURCE_RAW_RETENTION_DAYS: z.coerce.number().int().min(0).max(365).default(30),
  /** MFA TOTP para moderación y administración (ADR 0090). "auto" = exigida solo en producción. */
  STAFF_MFA_REQUIRED: z.enum(["auto", "true", "false"]).default("auto"),
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
  // Conectores (ADR 0064). Modo costo cero por defecto: ningún proveedor de pago arranca. Todo apagado salvo push.
  COST_MODE: z.enum(["zero", "metered"]).default("zero"),
  /** Proveedor de IA por defecto, opcional. "fixture" = respuestas fijas, sin red (desarrollo y pruebas). */
  AI_PROVIDER: z.enum(["none", "fixture"]).default("none"),
  /** Rutas del AI ROUTER por capacidad (ADR 0217): "CLASSIFY_INCIDENT=fixture;*=none". Vacío = AI_PROVIDER para todas. */
  AI_ROUTES: z.string().max(2000).default(""),
  AI_TIMEOUT_MS: z.coerce.number().int().min(500).max(60000).default(8000),
  TRANSLATION_PROVIDER: z.enum(["none"]).default("none"),
  SMS_PROVIDER: z.enum(["none", "log"]).default("none"),
  STT_PROVIDER: z.enum(["none"]).default("none"),
  TTS_PROVIDER: z.enum(["none"]).default("none"),
});

export type AppEnv = z.infer<typeof Env>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const env = Env.parse(source);
  if (env.NODE_ENV === "production" && env.EMAIL_PROVIDER === "log") {
    throw new Error("EMAIL_PROVIDER=log no puede usarse en producción");
  }
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
  if (env.NODE_ENV === "production" && env.STAFF_MFA_REQUIRED === "false") {
    throw new Error("En producción la moderación y la administración siempre exigen MFA (ADR 0090)");
  }
  if (env.NODE_ENV === "production" && env.PUSH_DRIVER !== "live") {
    throw new Error("Producción requiere PUSH_DRIVER=live (APNs y FCM)");
  }
  if (env.NODE_ENV === "production" && (env.AI_PROVIDER === "fixture" || /(^|[=,])\s*fixture\b/.test(env.AI_ROUTES) || env.SMS_PROVIDER === "log")) {
    throw new Error("AI_PROVIDER=fixture y SMS_PROVIDER=log son solo para desarrollo");
  }
  return env;
}

/** Acepta un secreto en claro o en base64 (cómodo para variables de entorno de una sola línea). */
export function decodeSecret(v: string): string {
  const t = v.trim();
  return t.startsWith("-----") || t.startsWith("{") ? t : Buffer.from(t, "base64").toString("utf8");
}
