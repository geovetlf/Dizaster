import type { AppEnv } from "./platform/config.js";
import { systemClock, type Clock } from "./platform/clock.js";
import { InMemoryCostGuard } from "./platform/cost-guard.js";
import { createPool, type Db } from "./platform/db.js";
import { OutboxDispatcher } from "./platform/outbox.js";
import { defaultDataDir } from "./platform/paths.js";
import { EventService } from "./modules/event/index.js";
import { GeoService } from "./modules/geo/index.js";
import { DevAttestationVerifier, IdentityService, type AttestationVerifier } from "./modules/identity/index.js";
import { IngestionScheduler, IngestionService, NodeHttpFetcher, type HttpFetcher } from "./modules/ingestion/index.js";
import { MediaService } from "./modules/media/index.js";
import { ReferenceData } from "./modules/reference/index.js";
import { ReportService } from "./modules/report/index.js";
import { SocialService } from "./modules/social/index.js";
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
  reports: ReportService;
  dispatcher: OutboxDispatcher;
  cost: InMemoryCostGuard;
}

export function buildContainer(env: AppEnv, overrides: { db?: Db; clock?: Clock; attestation?: AttestationVerifier; fetcher?: HttpFetcher } = {}): Container {
  const db = overrides.db ?? createPool(env.DATABASE_URL);
  const clock = overrides.clock ?? systemClock;
  const dataDir = env.DATA_DIR ?? defaultDataDir();
  const ref = new ReferenceData(dataDir);
  const geo = new GeoService(dataDir);
  const social = new SocialService();
  const identity = new IdentityService(db, social, env.AUTH_JWT_SECRET);
  const events = new EventService(ref, geo);
  const ingestion = new IngestionService(db, events);
  const ingestionScheduler = new IngestionScheduler(db, ingestion, overrides.fetcher ?? new NodeHttpFetcher(), clock);
  const verification = new VerificationService(db, ref, events, ingestion, identity);
  const media = new MediaService();
  if (env.NODE_ENV === "production" && !overrides.attestation) {
    throw new Error("Producción requiere un verificador real de App Attest / Play Integrity");
  }
  const reports = new ReportService({
    db, clock, ref, geo, social, events, identity, media,
    attestation: overrides.attestation ?? new DevAttestationVerifier(),
    limits: { reportsPerHour: env.REPORTS_PER_HOUR_LIMIT, presenceRetentionDays: env.PRESENCE_RETENTION_DAYS },
  });
  const dispatcher = new OutboxDispatcher(db);
  events.registerHandlers(dispatcher);
  verification.registerHandlers(dispatcher);
  // Presupuestos iniciales: las funciones de pago están a 0 hasta que se aprueben (cost-first).
  const cost = new InMemoryCostGuard({ "ai.daily": 0, "sms.daily": 0, "translation.daily": 0 }, { ai: true, sms: true, translation: true });
  return { env, db, clock, ref, geo, social, identity, events, ingestion, ingestionScheduler, verification, media, reports, dispatcher, cost };
}
