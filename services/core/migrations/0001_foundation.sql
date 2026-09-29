-- Dizaster · migración 0001 · fundación
-- Cada módulo es dueño de su esquema. Ningún módulo lee ni escribe tablas de otro esquema:
-- la comunicación es por interfaces públicas o eventos de dominio (outbox).

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS h3;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE SCHEMA IF NOT EXISTS platform;
CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS social;
CREATE SCHEMA IF NOT EXISTS report;
CREATE SCHEMA IF NOT EXISTS event;
CREATE SCHEMA IF NOT EXISTS verification;
CREATE SCHEMA IF NOT EXISTS ingestion;
CREATE SCHEMA IF NOT EXISTS media;

-- ───────────── platform: outbox de eventos de dominio ─────────────
CREATE TABLE platform.outbox (
  id              uuid PRIMARY KEY,
  type            text NOT NULL,
  version         int  NOT NULL DEFAULT 1,
  payload         jsonb NOT NULL,
  lane            text NOT NULL CHECK (lane IN ('urgent','interactive','normal','batch')),
  correlation_id  text,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  available_at    timestamptz NOT NULL DEFAULT now(),
  attempts        int NOT NULL DEFAULT 0,
  last_error      text,
  processed_at    timestamptz
);
CREATE INDEX outbox_pending_idx ON platform.outbox (lane, available_at) WHERE processed_at IS NULL;

-- Idempotencia por consumidor: un handler nunca procesa dos veces el mismo evento.
CREATE TABLE platform.outbox_consumption (
  consumer     text NOT NULL,
  outbox_id    uuid NOT NULL REFERENCES platform.outbox(id) ON DELETE CASCADE,
  consumed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, outbox_id)
);

-- ───────────── identity ─────────────
CREATE TABLE identity.users (
  id              uuid PRIMARY KEY,
  status          text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','DELETED')),
  roles           text[] NOT NULL DEFAULT '{}',
  primary_locale  text NOT NULL DEFAULT 'es',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE TABLE identity.auth_identities (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES identity.users(id),
  provider    text NOT NULL CHECK (provider IN ('APPLE','GOOGLE','EMAIL','PHONE','DEV')),
  subject     text NOT NULL,
  verified_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, subject)
);

CREATE TABLE identity.devices (
  id                  uuid PRIMARY KEY,
  user_id             uuid NOT NULL REFERENCES identity.users(id),
  platform            text NOT NULL CHECK (platform IN ('IOS','ANDROID')),
  app_version         text,
  push_token          text,
  attestation_status  text NOT NULL DEFAULT 'UNVERIFIED' CHECK (attestation_status IN ('UNVERIFIED','GENUINE','FAILED')),
  reputation          real NOT NULL DEFAULT 0.5,
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX devices_user_idx ON identity.devices (user_id);

-- ───────────── social ─────────────
CREATE TABLE social.profiles (
  id            uuid PRIMARY KEY,
  user_id       uuid NOT NULL UNIQUE,            -- referencia lógica a identity.users (sin FK entre esquemas)
  handle        text NOT NULL,
  display_name  text NOT NULL,
  home_country  char(2),
  locale        text NOT NULL DEFAULT 'es',
  units         text NOT NULL DEFAULT 'metric' CHECK (units IN ('metric','imperial')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX profiles_handle_idx ON social.profiles (lower(handle));

CREATE TABLE social.business_profiles (
  id                   uuid PRIMARY KEY,
  owner_user_id        uuid NOT NULL,
  handle               text NOT NULL,
  name                 text NOT NULL,
  category             text,
  country              char(2),
  verification_status  text NOT NULL DEFAULT 'UNVERIFIED' CHECK (verification_status IN ('UNVERIFIED','VERIFIED','INSTITUTIONAL_OFFICIAL')),
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX business_handle_idx ON social.business_profiles (lower(handle));

CREATE TABLE social.posts (
  id                uuid PRIMARY KEY,
  author_type       text NOT NULL CHECK (author_type IN ('PROFILE','BUSINESS')),
  author_id         uuid NOT NULL,
  kind              text NOT NULL CHECK (kind IN ('STANDARD','REPORT','SHARE','OFFICIAL_UPDATE')),
  -- PSEUDONYMOUS: la autoría no se expone públicamente ("Reporte ciudadano verificado en sitio").
  author_visibility text NOT NULL DEFAULT 'PUBLIC' CHECK (author_visibility IN ('PUBLIC','PSEUDONYMOUS')),
  text              text,
  lang              text,
  visibility        text NOT NULL DEFAULT 'PUBLIC' CHECK (visibility IN ('PUBLIC','FOLLOWERS','PRIVATE')),
  -- Ubicación pública YA generalizada. La ubicación precisa nunca vive en social.
  public_point      geography(Point, 4326),
  moderation_state  text NOT NULL DEFAULT 'VISIBLE' CHECK (moderation_state IN ('VISIBLE','LIMITED','HIDDEN','REMOVED')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
CREATE INDEX posts_author_idx ON social.posts (author_type, author_id, created_at DESC);

CREATE TABLE social.post_event_links (
  post_id    uuid NOT NULL REFERENCES social.posts(id),
  event_id   uuid NOT NULL,                       -- referencia lógica a event.events
  link_type  text NOT NULL CHECK (link_type IN ('REPORT','MENTION','UPDATE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, event_id)
);
CREATE INDEX post_event_links_event_idx ON social.post_event_links (event_id, created_at DESC);

-- ───────────── report ─────────────
CREATE TABLE report.reports (
  id                 uuid PRIMARY KEY,
  client_report_id   uuid NOT NULL,
  author_user_id     uuid NOT NULL,
  author_profile_id  uuid NOT NULL,
  device_id          uuid,
  post_id            uuid NOT NULL,
  event_id           uuid,
  category_code      text NOT NULL,
  assertion          text NOT NULL CHECK (assertion IN ('OCCURRING','NOT_OCCURRING')),
  pin                geography(Point, 4326) NOT NULL,
  pin_h3_r9          h3index NOT NULL,
  captured_at        timestamptz NOT NULL,
  received_at        timestamptz NOT NULL DEFAULT now(),
  captured_offline   boolean NOT NULL,
  presence_score     real NOT NULL,
  presence_band      text NOT NULL CHECK (presence_band IN ('HIGH','MEDIUM','LOW')),
  status             text NOT NULL CHECK (status IN ('ACCEPTED','DOWNGRADED','WITHDRAWN')),
  anonymity_mode     text NOT NULL CHECK (anonymity_mode IN ('PUBLIC','PSEUDONYMOUS')),
  result             jsonb NOT NULL,              -- respuesta original, para reintentos idempotentes
  UNIQUE (author_user_id, client_report_id)
);
CREATE INDEX reports_event_idx ON report.reports (event_id);
CREATE INDEX reports_author_time_idx ON report.reports (author_user_id, received_at DESC);

-- Evidencia de presencia: PRIVADA del sistema. Nunca se expone por la API pública.
-- Tras expires_at, un job la generaliza (celda H3 r7) y borra el fix preciso.
CREATE TABLE report.presence_evidence (
  report_id            uuid PRIMARY KEY REFERENCES report.reports(id),
  device_fix           jsonb,                     -- NULL tras la retención
  fix_h3_r7            h3index NOT NULL,
  fix_to_pin_m         real NOT NULL,
  mock_location        boolean,
  attestation_verdict  text NOT NULL CHECK (attestation_verdict IN ('GENUINE','FAILED','UNAVAILABLE')),
  reasons              text[] NOT NULL DEFAULT '{}',
  score_breakdown      jsonb NOT NULL,
  rule_version         text NOT NULL,
  expires_at           timestamptz NOT NULL,
  generalized_at       timestamptz
);
CREATE INDEX presence_expiry_idx ON report.presence_evidence (expires_at) WHERE generalized_at IS NULL;

-- ───────────── event ─────────────
CREATE TABLE event.events (
  id                  uuid PRIMARY KEY,
  category_code       text NOT NULL,
  title               jsonb,
  geom                geography(Point, 4326) NOT NULL,   -- ubicación agregada interna
  public_geom         geography(Point, 4326) NOT NULL,   -- ubicación pública generalizada
  public_h3           h3index NOT NULL,
  h3_r7               h3index NOT NULL,
  h3_r9               h3index NOT NULL,
  sensitivity         text NOT NULL CHECK (sensitivity IN ('NORMAL','SENSITIVE','HIGHLY_SENSITIVE')),
  uncertainty_m       real NOT NULL DEFAULT 0,
  country_code        char(2),
  occurred_start      timestamptz NOT NULL,
  occurred_end        timestamptz,
  first_seen_at       timestamptz NOT NULL,
  last_activity_at    timestamptz NOT NULL,
  severity            smallint NOT NULL CHECK (severity BETWEEN 1 AND 5),
  status              text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','MONITORING','RESOLVED','ARCHIVED')),
  publication_state   text NOT NULL CHECK (publication_state IN ('PUBLISHED','PENDING_CORROBORATION','HIDDEN')),
  -- Copias denormalizadas del Verification Engine para lecturas rápidas (fuente de verdad: esquema verification).
  verification_level  text NOT NULL DEFAULT 'UNVERIFIED',
  negative_state      text NOT NULL DEFAULT 'NONE',
  report_count        int NOT NULL DEFAULT 0,
  source_count        int NOT NULL DEFAULT 0,
  merged_into_id      uuid REFERENCES event.events(id),
  parent_event_id     uuid REFERENCES event.events(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_geom_idx ON event.events USING gist (geom);
CREATE INDEX events_public_geom_idx ON event.events USING gist (public_geom);
CREATE INDEX events_active_idx ON event.events (category_code, last_activity_at DESC) WHERE status IN ('ACTIVE','MONITORING') AND merged_into_id IS NULL;
CREATE INDEX events_h3_r7_idx ON event.events (h3_r7);

CREATE TABLE event.evidence (
  id                     uuid PRIMARY KEY,
  event_id               uuid NOT NULL REFERENCES event.events(id),
  evidence_type          text NOT NULL CHECK (evidence_type IN ('CITIZEN_REPORT','EXTERNAL_ITEM','OFFICIAL_ITEM','MEDIA','MODERATOR_NOTE','SENSOR')),
  ref_id                 uuid NOT NULL,
  -- El origen nunca se mezcla: ciudadano, externo u oficial.
  trust_tier             text NOT NULL CHECK (trust_tier IN ('CITIZEN','EXTERNAL','OFFICIAL')),
  assertion              text NOT NULL DEFAULT 'OCCURRING' CHECK (assertion IN ('OCCURRING','NOT_OCCURRING')),
  point                  geography(Point, 4326) NOT NULL,
  weight                 real NOT NULL,
  presence_band          text,
  contributor_user_id    uuid,
  contributor_device_id  uuid,
  match_score            real,
  match_confidence       text NOT NULL CHECK (match_confidence IN ('EXACT','USER_SELECTED','AUTO','AMBIGUOUS','NEW_EVENT')),
  added_by               text NOT NULL CHECK (added_by IN ('RULE','USER','MODERATOR','AI_SUGGESTION_ACCEPTED')),
  status                 text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DETACHED')),
  observed_at            timestamptz NOT NULL,
  added_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (evidence_type, ref_id)
);
CREATE INDEX evidence_event_idx ON event.evidence (event_id) WHERE status = 'ACTIVE';

CREATE TABLE event.timeline (
  id          uuid PRIMARY KEY,
  event_id    uuid NOT NULL REFERENCES event.events(id),
  type        text NOT NULL,                      -- abierto: tipos nuevos (LIVE_STARTED...) sin migrar
  payload     jsonb NOT NULL DEFAULT '{}',
  visibility  text NOT NULL DEFAULT 'PUBLIC' CHECK (visibility IN ('PUBLIC','INTERNAL')),
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX timeline_event_idx ON event.timeline (event_id, at);

-- Casos de deduplicación ambigua para revisión (reglas, IA con presupuesto o moderación).
CREATE TABLE event.dedup_reviews (
  id           uuid PRIMARY KEY,
  evidence_id  uuid NOT NULL REFERENCES event.evidence(id),
  candidates   jsonb NOT NULL,
  status       text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CONFIRMED','MOVED','DISMISSED')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz
);

CREATE TABLE event.merge_log (
  id               uuid PRIMARY KEY,
  target_event_id  uuid NOT NULL REFERENCES event.events(id),
  merged_event_id  uuid NOT NULL REFERENCES event.events(id),
  reason           text NOT NULL,
  score            real,
  actor            text NOT NULL,
  at               timestamptz NOT NULL DEFAULT now(),
  reverted_at      timestamptz
);

-- ───────────── verification ─────────────
CREATE TABLE verification.state (
  event_id          uuid PRIMARY KEY,
  level             text NOT NULL CHECK (level IN ('UNVERIFIED','COMMUNITY_CORROBORATED','EXTERNALLY_CORROBORATED','OFFICIALLY_CONFIRMED')),
  negative_state    text NOT NULL CHECK (negative_state IN ('NONE','DISPUTED','FALSE')),
  rule_set_version  text NOT NULL,
  explanation       jsonb NOT NULL DEFAULT '[]',
  evaluated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE verification.transitions (
  id            uuid PRIMARY KEY,
  event_id      uuid NOT NULL,
  from_level    text NOT NULL,
  to_level      text NOT NULL,
  from_negative text NOT NULL,
  to_negative   text NOT NULL,
  -- La IA no es una causa válida: sus sugerencias viven en ai_suggestions y no cambian estados.
  cause         text NOT NULL CHECK (cause IN ('RULE','OFFICIAL_SOURCE','MODERATOR')),
  rule_id       text,
  evidence_ids  uuid[] NOT NULL DEFAULT '{}',
  actor         text NOT NULL,
  reason        text,
  at            timestamptz NOT NULL DEFAULT now(),
  -- OFFICIALLY_CONFIRMED solo puede alcanzarse por una fuente oficial registrada, con evidencia.
  CONSTRAINT official_confirmation_requires_official_source CHECK (
    to_level <> 'OFFICIALLY_CONFIRMED' OR from_level = 'OFFICIALLY_CONFIRMED'
    OR (cause = 'OFFICIAL_SOURCE' AND cardinality(evidence_ids) > 0)
  ),
  -- FALSE solo por fuente oficial o por moderación con motivo y evidencia; nunca por votos automáticos.
  CONSTRAINT false_requires_official_or_moderator CHECK (
    to_negative <> 'FALSE' OR from_negative = 'FALSE'
    OR (cause IN ('OFFICIAL_SOURCE','MODERATOR') AND cardinality(evidence_ids) > 0 AND coalesce(length(reason), 0) >= 10)
  )
);
CREATE INDEX transitions_event_idx ON verification.transitions (event_id, at);

CREATE TABLE verification.ai_suggestions (
  id                 uuid PRIMARY KEY,
  event_id           uuid NOT NULL,
  task               text NOT NULL,
  suggested_level    text,
  suggested_negative text,
  rationale          text,
  provider           text NOT NULL,
  model              text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  -- Una sugerencia jamás propone OFFICIALLY_CONFIRMED.
  CHECK (suggested_level IS DISTINCT FROM 'OFFICIALLY_CONFIRMED')
);

-- ───────────── ingestion ─────────────
CREATE TABLE ingestion.sources (
  id                   uuid PRIMARY KEY,
  key                  text NOT NULL UNIQUE,
  name                 text NOT NULL,
  type                 text NOT NULL CHECK (type IN ('OFFICIAL','EXTERNAL','OPEN_DATA','NEWS','API','SENSOR')),
  trust_tier           text NOT NULL CHECK (trust_tier IN ('EXTERNAL','OFFICIAL')),
  country_scope        text[] NOT NULL,
  categories           text[] NOT NULL,
  adapter              text NOT NULL,
  config               jsonb NOT NULL DEFAULT '{}',
  license              text,
  terms_url            text,
  schedule_normal      text,
  urgent_capable       boolean NOT NULL DEFAULT false,
  urgent_poll_seconds  int,
  status               text NOT NULL CHECK (status IN ('ACTIVE','PAUSED','PLANNED','RESEARCH','RETIRED')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (trust_tier <> 'OFFICIAL' OR type = 'OFFICIAL')
);

CREATE TABLE ingestion.external_items (
  id            uuid PRIMARY KEY,
  source_id     uuid NOT NULL REFERENCES ingestion.sources(id),
  external_id   text NOT NULL,
  content_hash  text NOT NULL,
  lane          text NOT NULL CHECK (lane IN ('NORMAL','URGENT')),
  assertion     text NOT NULL DEFAULT 'OCCURRING' CHECK (assertion IN ('OCCURRING','NOT_OCCURRING')),
  published_at  timestamptz,
  fetched_at    timestamptz NOT NULL DEFAULT now(),
  raw_ref       text,                              -- clave en object storage (el crudo no vive en la BD)
  normalized    jsonb NOT NULL,
  status        text NOT NULL CHECK (status IN ('NEW','MAPPED','IGNORED','ERROR')),
  event_id      uuid,
  UNIQUE (source_id, external_id)
);

-- ───────────── media (modelo preparado para live; V1 usa IMAGE/VIDEO_RECORDED + FILE) ─────────────
CREATE TABLE media.media (
  id                    uuid PRIMARY KEY,
  owner_profile_id      uuid NOT NULL,
  kind                  text NOT NULL CHECK (kind IN ('IMAGE','VIDEO_RECORDED','LIVE_STREAM','AUDIO','DOCUMENT','SENSOR_FEED')),
  state                 text NOT NULL CHECK (state IN ('PENDING_UPLOAD','UPLOADED','PROCESSING','READY','REJECTED','LIVE','ENDED','VOD_READY','DELETED')),
  delivery              text NOT NULL DEFAULT 'FILE' CHECK (delivery IN ('FILE','HLS','LL_HLS','WEBRTC')),
  captured_in_app       boolean NOT NULL DEFAULT false,
  captured_at           timestamptz,
  duration_ms           int,
  width                 int,
  height                int,
  bytes                 bigint,
  mime                  text,
  sha256                text,
  phash                 text,
  storage_key_original  text,                      -- privado
  capture_h3_r9         h3index,                   -- privado; la geo precisa no se guarda en media pública
  moderation_state      text NOT NULL DEFAULT 'PENDING' CHECK (moderation_state IN ('PENDING','APPROVED','LIMITED','REMOVED')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE media.variants (
  media_id     uuid NOT NULL REFERENCES media.media(id),
  variant      text NOT NULL,                      -- THUMB_S, DISPLAY, VIDEO_720, POSTER, HLS_MASTER...
  storage_key  text NOT NULL,
  bytes        bigint,
  mime         text NOT NULL,
  PRIMARY KEY (media_id, variant)
);

-- Trayectorias (streams móviles, drones, tormentas). Definida desde ya; sin uso en V1.
CREATE TABLE media.geo_tracks (
  id            uuid PRIMARY KEY,
  subject_type  text NOT NULL CHECK (subject_type IN ('MEDIA','EVENT','DEVICE')),
  subject_id    uuid NOT NULL,
  points        jsonb NOT NULL DEFAULT '[]',
  created_at    timestamptz NOT NULL DEFAULT now()
);
