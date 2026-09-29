-- Alert Engine (Blueprint §5.10): decide a quién avisar, de qué y cuándo; entrega por APNs/FCM directos.
CREATE SCHEMA IF NOT EXISTS alert;

-- Preferencias por perfil. Sin fila = valores por defecto (alertas activas, severidad mínima 3, 6 por hora).
CREATE TABLE alert.preferences (
  profile_id       uuid PRIMARY KEY,                  -- referencia lógica a social.profiles
  enabled          boolean NOT NULL DEFAULT true,
  followed_events  boolean NOT NULL DEFAULT true,
  followed_places  boolean NOT NULL DEFAULT true,
  categories       boolean NOT NULL DEFAULT true,
  status_changes   boolean NOT NULL DEFAULT true,
  min_severity     smallint NOT NULL DEFAULT 3 CHECK (min_severity BETWEEN 1 AND 5),
  max_per_hour     smallint NOT NULL DEFAULT 6 CHECK (max_per_hour BETWEEN 1 AND 30),
  quiet_start      smallint CHECK (quiet_start BETWEEN 0 AND 1439),
  quiet_end        smallint CHECK (quiet_end BETWEEN 0 AND 1439),
  timezone         text NOT NULL DEFAULT 'UTC',
  lang             text NOT NULL DEFAULT 'es' CHECK (lang IN ('es','en')),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((quiet_start IS NULL) = (quiet_end IS NULL))
);

-- Categoría + área (id del índice geográfico o país ISO2) + severidad mínima.
CREATE TABLE alert.subscriptions (
  id             uuid PRIMARY KEY,
  profile_id     uuid NOT NULL,
  category_code  text NOT NULL,
  area_id        text NOT NULL,
  min_severity   smallint NOT NULL DEFAULT 3 CHECK (min_severity BETWEEN 1 AND 5),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, category_code, area_id)
);
CREATE INDEX subscriptions_area_idx ON alert.subscriptions (area_id);

-- Lo último que el Alert Engine vio de cada EVENT: detecta cambios sin volver a avisar de lo mismo.
CREATE TABLE alert.event_state (
  event_id      uuid PRIMARY KEY,
  public_state  text NOT NULL,
  severity      smallint NOT NULL,
  status        text NOT NULL,
  announced     boolean NOT NULL DEFAULT false,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Una alerta por EVENT y motivo (dedup_key única): "evento nuevo", "confirmado oficialmente", "resuelto"…
-- Solo contiene datos públicos del EVENT (categoría, lugar contextual, estado), nunca autoría ni ubicación privada.
CREATE TABLE alert.alerts (
  id             uuid PRIMARY KEY,
  event_id       uuid NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('NEW_EVENT','STATE_CHANGED','SEVERITY_UP','RESOLVED')),
  dedup_key      text NOT NULL UNIQUE,
  category_code  text NOT NULL,
  severity       smallint NOT NULL,
  public_state   text NOT NULL,
  place_label    text,
  critical       boolean NOT NULL DEFAULT false,   -- confirmación oficial grave: ignora horas de silencio
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX alerts_event_idx ON alert.alerts (event_id);

-- Historial por persona (y cola de entrega). Una persona recibe cada alerta una sola vez.
CREATE TABLE alert.notifications (
  id            uuid PRIMARY KEY,
  alert_id      uuid NOT NULL REFERENCES alert.alerts(id),
  profile_id    uuid NOT NULL,
  user_id       uuid NOT NULL,                       -- para encontrar sus dispositivos sin cruzar esquemas en caliente
  match         text NOT NULL CHECK (match IN ('FOLLOWED_EVENT','FOLLOWED_PLACE','CATEGORY','PREVIOUSLY_ALERTED')),
  title         text NOT NULL,
  body          text NOT NULL,
  status        text NOT NULL DEFAULT 'PENDING'
                CHECK (status IN ('PENDING','SENT','GROUPED','SILENT_RATE_LIMIT','SILENT_QUIET_HOURS','NO_DEVICE','FAILED')),
  group_id      uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  pushed_at     timestamptz,
  read_at       timestamptz,
  UNIQUE (profile_id, alert_id)
);
CREATE INDEX notifications_pending_idx ON alert.notifications (created_at) WHERE status = 'PENDING';
CREATE INDEX notifications_profile_idx ON alert.notifications (profile_id, created_at DESC, id DESC);
CREATE INDEX notifications_pushed_idx ON alert.notifications (profile_id, pushed_at) WHERE pushed_at IS NOT NULL;
