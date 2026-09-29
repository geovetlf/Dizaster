-- Moderation Layer (ADR 0020): denuncias, casos priorizados, acciones auditables y apelaciones. Bloqueos en social.
CREATE SCHEMA IF NOT EXISTS moderation;

-- Un caso por objeto denunciado mientras esté abierto; las denuncias se acumulan en él.
CREATE TABLE moderation.cases (
  id            uuid PRIMARY KEY,
  target_type   text NOT NULL CHECK (target_type IN ('POST','COMMENT','EVENT','PROFILE')),
  target_id     uuid NOT NULL,
  status        text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED','DISMISSED')),
  priority      real NOT NULL DEFAULT 0,
  opened_at     timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz,
  resolved_by   uuid
);
CREATE UNIQUE INDEX cases_open_target_idx ON moderation.cases (target_type, target_id) WHERE status = 'OPEN';
CREATE INDEX cases_queue_idx ON moderation.cases (status, priority DESC, opened_at);

-- Denuncias. Una por persona y objeto: repetir no suma prioridad.
CREATE TABLE moderation.flags (
  id                   uuid PRIMARY KEY,
  case_id              uuid NOT NULL REFERENCES moderation.cases(id),
  target_type          text NOT NULL,
  target_id            uuid NOT NULL,
  reporter_profile_id  uuid NOT NULL,
  reporter_weight      real NOT NULL,
  reason               text NOT NULL CHECK (reason IN ('PRIVACY','VIOLENCE','ILLEGAL','HARASSMENT','FALSE_INFO','SPAM','OTHER')),
  note                 text CHECK (length(note) <= 500),
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (target_type, target_id, reporter_profile_id)
);
CREATE INDEX flags_reporter_idx ON moderation.flags (reporter_profile_id, created_at DESC);

-- Registro de acciones: solo se inserta, nunca se modifica (auditoría).
CREATE TABLE moderation.actions (
  id                  uuid PRIMARY KEY,
  case_id             uuid REFERENCES moderation.cases(id),
  target_type         text NOT NULL,
  target_id           uuid NOT NULL,
  -- Cuenta afectada (para avisarle y permitir apelar). Nunca se muestra a otras personas.
  affected_user_id    uuid,
  action              text NOT NULL CHECK (action IN ('HIDE','REMOVE','RESTORE','LIMIT','WARN_USER','SUSPEND_USER','UNSUSPEND_USER','MARK_DISPUTED','DISMISS')),
  actor               text NOT NULL CHECK (actor IN ('RULE','MODERATOR')),
  moderator_user_id   uuid,
  reason              text NOT NULL,
  reverses_action_id  uuid REFERENCES moderation.actions(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK ((actor = 'MODERATOR') = (moderator_user_id IS NOT NULL))
);
CREATE INDEX actions_affected_idx ON moderation.actions (affected_user_id, created_at DESC);
CREATE INDEX actions_case_idx ON moderation.actions (case_id, created_at);

CREATE TABLE moderation.appeals (
  id                  uuid PRIMARY KEY,
  action_id           uuid NOT NULL UNIQUE REFERENCES moderation.actions(id),
  appellant_user_id   uuid NOT NULL,
  text                text NOT NULL CHECK (length(text) BETWEEN 10 AND 1000),
  status              text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','UPHELD','REVERSED')),
  decision_reason     text,
  decided_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  decided_at          timestamptz
);
CREATE INDEX appeals_open_idx ON moderation.appeals (status, created_at);

-- Bloqueo entre personas: oculta al bloqueador los posts con nombre y los comentarios del bloqueado.
CREATE TABLE social.blocks (
  blocker_profile_id  uuid NOT NULL REFERENCES social.profiles(id),
  blocked_profile_id  uuid NOT NULL REFERENCES social.profiles(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_profile_id, blocked_profile_id),
  CHECK (blocker_profile_id <> blocked_profile_id)
);
