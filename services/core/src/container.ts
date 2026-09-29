import { createHmac } from "node:crypto";
import { resolve } from "node:path";
import { decodeSecret, type AppEnv } from "./platform/config.js";
import { systemClock, type Clock } from "./platform/clock.js";
import { Meter } from "./platform/metrics.js";
import { fieldCipherFromEnv } from "./platform/field-cipher.js";
import { createPool, type Db } from "./platform/db.js";
import { OutboxDispatcher } from "./platform/outbox.js";
import { buildConnectors, type ConnectorOverrides, type Connectors } from "./platform/connectors/index.js";
import { defaultDataDir } from "./platform/paths.js";
import { CostService } from "./modules/cost/index.js";
import { EventService } from "./modules/event/index.js";
import { FeedService } from "./modules/feed/index.js";
import { AlertService, ApnsSender, budgetAlertText, sourceAlertText, FcmSender, LogPushSender, PushGateway, type FcmServiceAccount, type PushSender } from "./modules/alert/index.js";
import { GeoService } from "./modules/geo/index.js";
import { ModerationService } from "./modules/moderation/index.js";
import { TrustService } from "./modules/trust/index.js";
import { DevAttestationVerifier, IdentityService, type AttestationVerifier } from "./modules/identity/index.js";
import { IngestionScheduler, IngestionService, NodeHttpFetcher, type HttpFetcher } from "./modules/ingestion/index.js";
import { LocalDiskStorage, MediaService, S3Storage, type StorageProvider } from "./modules/media/index.js";
import { QualityService } from "./modules/quality/index.js";
import { ReferenceData } from "./modules/reference/index.js";
import { ReportService } from "./modules/report/index.js";
import { BusinessService, PostComposer, SocialService } from "./modules/social/index.js";
import { VerificationService } from "./modules/verification/index.js";

/** Raíz de composición: el único lugar que conoce todas las implementaciones concretas. */
export interface Container {
  env: AppEnv;
  db: Db;
  clock: Clock;
  ref: ReferenceData;
  geo: GeoService;
  social: SocialService;
  identity: IdentityService;
  events: EventService;
  ingestion: IngestionService;
  ingestionScheduler: IngestionScheduler;
  verification: VerificationService;
  media: MediaService;
  storage: StorageProvider;
  reports: ReportService;
  feed: FeedService;
  alerts: AlertService;
  dispatcher: OutboxDispatcher;
  cost: CostService;
  connectors: Connectors;
  moderation: ModerationService;
  trust: TrustService;
  quality: QualityService;
  composer: PostComposer;
  business: BusinessService;
  meter: Meter;
}

export function buildContainer(env: AppEnv, overrides: { db?: Db; clock?: Clock; attestation?: AttestationVerifier; fetcher?: HttpFetcher; storage?: StorageProvider; push?: PushSender; connectors?: ConnectorOverrides } = {}): Container {
  const db = overrides.db ?? createPool(env.DATABASE_URL);
  const clock = overrides.clock ?? systemClock;
  const meter = new Meter(() => clock.now());
  const dataDir = env.DATA_DIR ?? defaultDataDir();
  const ref = new ReferenceData(dataDir);
  const geo = new GeoService(dataDir, ref, meter);
  // Números públicos (emergencias) en dígitos: publicarlos no es exponer datos personales (ADR 0088).
  const social = new SocialService(new Set(ref.emergency.numbers.map((n) => n.number.replace(/\D/g, "")).filter((d) => d.length >= 8)));
  const identity = new IdentityService(db, social, env.AUTH_JWT_SECRET);
  const events = new EventService(ref, geo, { archiveAfterDays: env.EVENT_ARCHIVE_AFTER_DAYS });
  const ingestion = new IngestionService(db, events, geo);
  // Claves de fuentes (SOURCE_KEY_*): solo del entorno, nunca en data/ (ADR 0067).
  const sourceSecrets = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith("SOURCE_KEY_")));
  const storage = overrides.storage ?? buildStorage(env, clock);
  const ingestionScheduler = new IngestionScheduler(db, ingestion, overrides.fetcher ?? new NodeHttpFetcher(), clock, sourceSecrets,
    env.SOURCE_RAW_RETENTION_DAYS > 0 ? { storage, retentionDays: env.SOURCE_RAW_RETENTION_DAYS } : null);
  const trust = new TrustService(db, identity, events);
  const verification = new VerificationService(db, ref, events, ingestion, trust);
  const media = new MediaService(db, storage, clock, {
    uploadsPerHour: env.MEDIA_UPLOADS_PER_HOUR_LIMIT,
    uploadUrlTtlSeconds: env.MEDIA_UPLOAD_URL_TTL_SECONDS,
    originalRetentionDays: env.MEDIA_ORIGINAL_RETENTION_DAYS,
  });
  if (env.NODE_ENV === "production" && !overrides.attestation) {
    throw new Error("Producción requiere un verificador real de App Attest / Play Integrity");
  }
  const reports = new ReportService({
    db, clock, ref, geo, social, events, identity, media, trust,
    attestation: overrides.attestation ?? new DevAttestationVerifier(),
    limits: { reportsPerHour: env.REPORTS_PER_HOUR_LIMIT, presenceRetentionDays: env.PRESENCE_RETENTION_DAYS },
    cipher: fieldCipherFromEnv(env.FIELD_KEYS, env.AUTH_JWT_SECRET),
  });
  const business = new BusinessService(db);
  const feed = new FeedService(social, events, media, ref, geo, business);
  const dispatcher = new OutboxDispatcher(db);
  events.registerHandlers(dispatcher);
  verification.registerHandlers(dispatcher);
  media.registerHandlers(dispatcher);
  feed.registerHandlers(dispatcher);
  const alerts = new AlertService(db, ref, events, social, identity, geo, overrides.push ?? buildPush(env, clock), clock);
  alerts.registerHandlers(dispatcher);
  social.registerHandlers(dispatcher);
  reports.registerHandlers(dispatcher);
  trust.registerHandlers(dispatcher);
  // Presupuestos y kill switches persistidos: las funciones de pago empiezan a 0 y apagadas (migración 0009).
  const cost = new CostService(db, identity, media, clock, dataDir);
  // Conectores (ADR 0064): IA, traducción, SMS y voz detrás de interfaces; apagados por defecto, costo cero.
  const connectors = buildConnectors(env, cost, overrides.connectors);
  const moderation = new ModerationService(db, social, identity, events, verification, trust, media);
  moderation.registerHandlers(dispatcher);
  dispatcher.on("BudgetThresholdReached", "cost.log-threshold", async (e) => {
    console.warn(JSON.stringify({ msg: "cost.budget.threshold", ...e.payload }));
  });
  // Aviso push a administración (ADR 0026). Idempotente por umbral y periodo: cost solo publica una vez cada uno.
  dispatcher.on("BudgetThresholdReached", "alert.notify-admins-budget", async (e) => {
    const admins = await identity.usersWithRole(db, "admin");
    await alerts.notifyAdmins(admins, (lang) => budgetAlertText(lang, e.payload), "dizaster://admin-cost", `budget:${e.payload.key}`);
  });
  // Fuentes urgentes caídas o recuperadas (ADR 0058): log estructurado y push a administración.
  dispatcher.on("SourceHealthChanged", "alert.notify-admins-source", async (e) => {
    console.warn(JSON.stringify({ msg: "ingestion.source.health", ...e.payload }));
    const admins = await identity.usersWithRole(db, "admin");
    await alerts.notifyAdmins(admins, (lang) => sourceAlertText(lang, e.payload), "dizaster://admin-quality", `source:${e.payload.sourceKey}`);
  });
  const composer = new PostComposer(db, social, media, events, business);
  const quality = new QualityService(db, clock, { cost, events, verification, alerts, ingestion, moderation });
  return { env, db, clock, ref, geo, social, identity, events, ingestion, ingestionScheduler, verification, media, storage, reports, feed, alerts, dispatcher, cost, moderation, trust, quality, composer, business, meter, connectors };
}

/** APNs y FCM directos. Si falta la credencial de una plataforma, sus avisos quedan solo en el historial. */
function buildPush(env: AppEnv, clock: Clock): PushSender {
  if (env.PUSH_DRIVER === "log") return new LogPushSender();
  const now = () => clock.now();
  const apns = env.APNS_TEAM_ID && env.APNS_KEY_ID && env.APNS_PRIVATE_KEY
    ? new ApnsSender({ teamId: env.APNS_TEAM_ID, keyId: env.APNS_KEY_ID, privateKeyPem: decodeSecret(env.APNS_PRIVATE_KEY), bundleId: env.APNS_BUNDLE_ID }, now)
    : null;
  const fcm = env.FCM_SERVICE_ACCOUNT_JSON
    ? new FcmSender({ account: JSON.parse(decodeSecret(env.FCM_SERVICE_ACCOUNT_JSON)) as FcmServiceAccount }, now)
    : null;
  if (!apns) console.warn(JSON.stringify({ msg: "push.apns.disabled", reason: "faltan APNS_TEAM_ID, APNS_KEY_ID o APNS_PRIVATE_KEY" }));
  if (!fcm) console.warn(JSON.stringify({ msg: "push.fcm.disabled", reason: "falta FCM_SERVICE_ACCOUNT_JSON" }));
  return new PushGateway({ APNS: apns, FCM: fcm });
}

function buildStorage(env: AppEnv, clock: Clock): StorageProvider {
  if (env.STORAGE_DRIVER === "s3") {
    return new S3Storage({
      endpoint: env.S3_ENDPOINT!, region: env.S3_REGION, bucket: env.S3_BUCKET!,
      accessKeyId: env.S3_ACCESS_KEY_ID!, secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
      forcePathStyle: env.S3_FORCE_PATH_STYLE, publicBaseUrl: env.MEDIA_PUBLIC_BASE_URL ?? null,
    }, () => clock.now());
  }
  // La firma local deriva del secreto de sesión con un contexto propio: no reutiliza la misma clave.
  const secret = createHmac("sha256", env.AUTH_JWT_SECRET).update("dizaster/local-storage").digest("hex");
  return new LocalDiskStorage(resolve(env.STORAGE_LOCAL_DIR), env.PUBLIC_API_URL, secret, () => clock.now());
}
