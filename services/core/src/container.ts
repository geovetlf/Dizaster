import { createHmac } from "node:crypto";
import { resolve } from "node:path";
import { INGESTION_NORMAL_KILL_SWITCH } from "@dizaster/contracts";
import { decodeSecret, type AppEnv } from "./platform/config.js";
import { systemClock, type Clock } from "./platform/clock.js";
import { Meter } from "./platform/metrics.js";
import { fieldCipherFromEnv } from "./platform/field-cipher.js";
import { createPool, type Db } from "./platform/db.js";
import { OutboxDispatcher } from "./platform/outbox.js";
import { ClientCrashService } from "./platform/client-crashes.js";
import { HeartbeatService } from "./platform/heartbeat.js";
import { CircuitBreaker } from "./platform/breaker.js";
import { inProcessDecoder, IsolatedDecoder } from "./modules/media/index.js";
import { buildConnectors, type ConnectorOverrides, type Connectors } from "./platform/connectors/index.js";
import { defaultDataDir } from "./platform/paths.js";
import { CostService } from "./modules/cost/index.js";
import { EventService } from "./modules/event/index.js";
import { FeedService } from "./modules/feed/index.js";
import { AlertService, ApnsSender, budgetAlertText, costDegradationText, sourceAlertText, FcmSender, GuardedSender, LogPushSender, PushGateway, type FcmServiceAccount, type PushSender } from "./modules/alert/index.js";
import { GeoService } from "./modules/geo/index.js";
import { AuthorityRequestRegister, ModerationService } from "./modules/moderation/index.js";
import { TrustService } from "./modules/trust/index.js";
import { APPLE_ISSUERS, DevAttestationVerifier, ExternalAuthService, GOOGLE_ISSUERS, IdentityService, MfaService, OidcIdTokenVerifier, appleKeys, googleKeys, type AttestationVerifier } from "./modules/identity/index.js";
import type { JWTVerifyGetKey } from "jose";
import { DisabledEmailSender, LogEmailSender, type EmailSender } from "./platform/email.js";
import { IngestionScheduler, IngestionService, InstitutionService, NodeHttpFetcher, type HttpFetcher } from "./modules/ingestion/index.js";
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
  externalAuth: ExternalAuthService;
  mfa: MfaService;
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
  crashes: ClientCrashService;
  heartbeat: HeartbeatService;
  cost: CostService;
  connectors: Connectors;
  moderation: ModerationService;
  authorityRequests: AuthorityRequestRegister;
  trust: TrustService;
  quality: QualityService;
  composer: PostComposer;
  business: BusinessService;
  institutions: InstitutionService;
  meter: Meter;
}

export function buildContainer(env: AppEnv, overrides: { db?: Db; clock?: Clock; attestation?: AttestationVerifier; fetcher?: HttpFetcher; storage?: StorageProvider; push?: PushSender; connectors?: ConnectorOverrides; email?: EmailSender; oidcKeys?: { apple?: JWTVerifyGetKey; google?: JWTVerifyGetKey } } = {}): Container {
  const db = overrides.db ?? createPool(env.DATABASE_URL, {
    max: env.DB_POOL_MAX, connectionTimeoutMs: env.DB_CONNECTION_TIMEOUT_MS, statementTimeoutMs: env.DB_STATEMENT_TIMEOUT_MS,
    lockTimeoutMs: env.DB_LOCK_TIMEOUT_MS, idleInTransactionTimeoutMs: env.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS, applicationName: "dizaster-core",
  });
  const clock = overrides.clock ?? systemClock;
  const meter = new Meter(() => clock.now());
  const dataDir = env.DATA_DIR ?? defaultDataDir();
  const ref = new ReferenceData(dataDir);
  const geo = new GeoService(dataDir, ref, meter);
  // Números públicos (emergencias) en dígitos: publicarlos no es exponer datos personales (ADR 0088).
  const social = new SocialService(new Set(ref.emergency.numbers.map((n) => n.number.replace(/\D/g, "")).filter((d) => d.length >= 8)), ref.moderationTerms);
  const identity = new IdentityService(db, social, env.AUTH_JWT_SECRET);
  // Apple, Google y correo (ADR 0170): apagados mientras no haya client id / proveedor de correo del propietario.
  const list = (v: string) => v.split(",").map((x) => x.trim()).filter(Boolean);
  const externalAuth = new ExternalAuthService(db, identity, clock, {
    apple: new OidcIdTokenVerifier("APPLE", APPLE_ISSUERS, list(env.AUTH_APPLE_AUDIENCES), overrides.oidcKeys?.apple ?? appleKeys()),
    google: new OidcIdTokenVerifier("GOOGLE", GOOGLE_ISSUERS, list(env.AUTH_GOOGLE_AUDIENCES), overrides.oidcKeys?.google ?? googleKeys()),
  }, overrides.email ?? (env.EMAIL_PROVIDER === "log" ? new LogEmailSender() : new DisabledEmailSender()), env.AUTH_JWT_SECRET);
  const events = new EventService(ref, geo, { archiveAfterDays: env.EVENT_ARCHIVE_AFTER_DAYS });
  const ingestion = new IngestionService(db, events, geo);
  // Claves de fuentes (SOURCE_KEY_*) y secretos de push (SOURCE_PUSH_SECRET_*): solo del entorno (ADR 0067, 0128).
  const sourceSecrets = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith("SOURCE_KEY_") || k.startsWith("SOURCE_PUSH_SECRET_")));
  const storage = overrides.storage ?? buildStorage(env, clock);
  const ingestionScheduler = new IngestionScheduler(db, ingestion, overrides.fetcher ?? new NodeHttpFetcher(), clock, sourceSecrets,
    env.SOURCE_RAW_RETENTION_DAYS > 0 ? { storage, retentionDays: env.SOURCE_RAW_RETENTION_DAYS } : null,
    // `cost` se crea más abajo; la función solo se evalúa en cada tick (ADR 0138).
    () => cost.isKilled(INGESTION_NORMAL_KILL_SWITCH));
  const trust = new TrustService(db, identity, events);
  const verification = new VerificationService(db, ref, events, ingestion, trust);
  const media = new MediaService(db, storage, clock, {
    uploadsPerHour: env.MEDIA_UPLOADS_PER_HOUR_LIMIT,
    uploadUrlTtlSeconds: env.MEDIA_UPLOAD_URL_TTL_SECONDS,
    originalRetentionDays: env.MEDIA_ORIGINAL_RETENTION_DAYS,
  }, env.MEDIA_DECODER === "inprocess" ? inProcessDecoder
    : new IsolatedDecoder({ timeoutMs: env.MEDIA_DECODE_TIMEOUT_MS, maxOldSpaceMb: env.MEDIA_DECODER_MAX_OLD_SPACE_MB }));
  if (env.NODE_ENV === "production" && !overrides.attestation) {
    throw new Error("Producción requiere un verificador real de App Attest / Play Integrity");
  }
  const fieldCipher = fieldCipherFromEnv(env.FIELD_KEYS, env.AUTH_JWT_SECRET);
  const mfa = new MfaService(db, fieldCipher, clock, env.STAFF_MFA_REQUIRED === "true" || (env.STAFF_MFA_REQUIRED === "auto" && env.NODE_ENV === "production"));
  const reports = new ReportService({
    db, clock, ref, geo, social, events, identity, media, trust,
    attestation: overrides.attestation ?? new DevAttestationVerifier(),
    limits: { reportsPerHour: env.REPORTS_PER_HOUR_LIMIT, presenceRetentionDays: env.PRESENCE_RETENTION_DAYS },
    cipher: fieldCipher,
  });
  trust.usePhoneSignals((q, deviceId) => reports.phoneSignals(q, deviceId));
  const business = new BusinessService(db);
  const feed = new FeedService(social, events, media, ref, geo, business);
  const dispatcher = new OutboxDispatcher(db);
  events.registerHandlers(dispatcher);
  verification.registerHandlers(dispatcher);
  media.registerHandlers(dispatcher);
  feed.registerHandlers(dispatcher);
  const alerts = new AlertService(db, ref, events, social, identity, geo, overrides.push ?? buildPush(env, clock, meter), clock, ingestion, { ttlHours: env.ALERT_DEFAULT_TTL_HOURS });
  alerts.registerHandlers(dispatcher);
  social.registerHandlers(dispatcher);
  reports.registerHandlers(dispatcher);
  ingestion.registerHandlers(dispatcher);
  trust.registerHandlers(dispatcher);
  // Presupuestos y kill switches persistidos: las funciones de pago empiezan a 0 y apagadas (migración 0009).
  const cost = new CostService(db, identity, media, clock, dataDir);
  // Conectores (ADR 0064): IA, traducción, SMS y voz detrás de interfaces; apagados por defecto, costo cero.
  cost.registerHandlers(dispatcher);
  const connectors = buildConnectors(env, cost, overrides.connectors, cost);
  const moderation = new ModerationService(db, social, identity, events, verification, trust, media);
  moderation.registerHandlers(dispatcher);
  const authorityRequests = new AuthorityRequestRegister(db, () => clock.now());
  dispatcher.on("BudgetThresholdReached", "cost.log-threshold", async (e) => {
    console.warn(JSON.stringify({ msg: "cost.budget.threshold", ...e.payload }));
  });
  // Aviso push a administración (ADR 0026). Idempotente por umbral y periodo: cost solo publica una vez cada uno.
  dispatcher.on("BudgetThresholdReached", "alert.notify-admins-budget", async (e) => {
    const admins = await identity.usersWithRole(db, "admin");
    await alerts.notifyAdmins(admins, (lang) => budgetAlertText(lang, e.payload), "dizaster://admin-cost", `budget:${e.payload.key}`);
  });
  // Degradación automática por costo (ADR 0138): administración y operación saben qué se apagó o se restauró.
  dispatcher.on("CostDegradationChanged", "alert.notify-admins-degradation", async (e) => {
    console.warn(JSON.stringify({ msg: "cost.degradation", ...e.payload }));
    const admins = [...new Set([...(await identity.usersWithRole(db, "admin")), ...(await identity.usersWithRole(db, "operator"))])];
    await alerts.notifyAdmins(admins, (lang) => costDegradationText(lang, e.payload), "dizaster://admin-cost", `degradation:${e.payload.feature}`);
  });
  // Fuentes urgentes caídas o recuperadas (ADR 0058): log estructurado y push a administración.
  dispatcher.on("SourceHealthChanged", "alert.notify-admins-source", async (e) => {
    console.warn(JSON.stringify({ msg: "ingestion.source.health", ...e.payload }));
    // Operación también recibe la caída de fuentes (ADR 0101).
    const admins = [...new Set([...(await identity.usersWithRole(db, "admin")), ...(await identity.usersWithRole(db, "operator"))])];
    await alerts.notifyAdmins(admins, (lang) => sourceAlertText(lang, e.payload), "dizaster://admin-quality", `source:${e.payload.sourceKey}`);
  });
  // Perfiles institucionales oficiales como fuente OFICIAL (ADR 0095).
  const institutions = new InstitutionService(db, ingestion, events, business, ref, geo, clock);
  dispatcher.on("AccountDeleted", "ingestion.retire-institutions", async (e, tx) => {
    await institutions.retire(tx, await business.idsOwnedBy(tx, e.payload.userId));
  });
  const composer = new PostComposer(db, social, media, events, business, async (userId) => (await trust.socialLimits(db, userId)).postsPerHour,
    (userId, handle, event) => institutions.assertCanPostUpdate(userId, handle, event));
  const quality = new QualityService(db, clock, { cost, events, verification, alerts, ingestion, moderation, ops: { identity, backlog: () => dispatcher.backlog() } });
  return { env, db, clock, ref, geo, social, identity, externalAuth, mfa, events, ingestion, ingestionScheduler, verification, media, storage, reports, feed, alerts, dispatcher, crashes: new ClientCrashService(db),
    heartbeat: new HeartbeatService(db, { staleSeconds: env.WORKER_HEARTBEAT_STALE_SECONDS, outboxMaxAgeSeconds: env.OUTBOX_READY_MAX_AGE_SECONDS }), cost, moderation, authorityRequests, trust, quality, composer, business, institutions, meter, connectors };
}

/** APNs y FCM directos. Si falta la credencial de una plataforma, sus avisos quedan solo en el historial. */
function buildPush(env: AppEnv, clock: Clock, meter: Meter): PushSender {
  if (env.PUSH_DRIVER === "log") return new LogPushSender();
  const now = () => clock.now();
  const timeoutMs = env.PUSH_REQUEST_TIMEOUT_MS;
  // ADR 0205: cada proveedor con su cortocircuito; abrirlo queda en métricas y en el log (alerta de operación).
  const guard = (sender: PushSender, provider: string) => new GuardedSender(sender, new CircuitBreaker({
    threshold: env.PUSH_BREAKER_THRESHOLD, cooldownMs: env.PUSH_BREAKER_COOLDOWN_MS, maxCooldownMs: 10 * 60_000,
    now: () => clock.now().getTime(),
    onOpen: (i) => {
      meter.add("push", "circuit_open", 1, provider);
      console.warn(JSON.stringify({ msg: "push.circuit.open", provider, failures: i.failures, cooldownMs: i.cooldownMs }));
    },
    onClose: () => console.warn(JSON.stringify({ msg: "push.circuit.closed", provider })),
  }));
  const apns = env.APNS_TEAM_ID && env.APNS_KEY_ID && env.APNS_PRIVATE_KEY
    ? guard(new ApnsSender({ teamId: env.APNS_TEAM_ID, keyId: env.APNS_KEY_ID, privateKeyPem: decodeSecret(env.APNS_PRIVATE_KEY), bundleId: env.APNS_BUNDLE_ID, timeoutMs }, now), "apns")
    : null;
  const fcm = env.FCM_SERVICE_ACCOUNT_JSON
    ? guard(new FcmSender({ account: JSON.parse(decodeSecret(env.FCM_SERVICE_ACCOUNT_JSON)) as FcmServiceAccount, timeoutMs }, now), "fcm")
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
      forcePathStyle: env.S3_FORCE_PATH_STYLE, publicBaseUrl: env.MEDIA_PUBLIC_BASE_URL ?? null, timeoutMs: env.STORAGE_REQUEST_TIMEOUT_MS,
    }, () => clock.now());
  }
  // La firma local deriva del secreto de sesión con un contexto propio: no reutiliza la misma clave.
  const secret = createHmac("sha256", env.AUTH_JWT_SECRET).update("dizaster/local-storage").digest("hex");
  return new LocalDiskStorage(resolve(env.STORAGE_LOCAL_DIR), env.PUBLIC_API_URL, secret, () => clock.now());
}
