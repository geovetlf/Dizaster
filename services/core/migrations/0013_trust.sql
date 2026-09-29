-- Trust & Safety (Blueprint §13.3, ADR 0023): señales de reputación alimentadas por el outbox.
CREATE SCHEMA IF NOT EXISTS trust;

-- Una fila por persona y evento en el que aportó un reporte ciudadano.
CREATE TABLE trust.contributions (
  user_id     uuid NOT NULL,
  event_id    uuid NOT NULL,
  assertion   text NOT NULL CHECK (assertion IN ('OCCURRING','NOT_OCCURRING')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event_id)
);
CREATE INDEX contributions_event_idx ON trust.contributions (event_id);
CREATE INDEX contributions_user_time_idx ON trust.contributions (user_id, created_at DESC);

-- Cómo terminó cada evento (según VerificationChanged). DISPUTED no cuenta: aún no se sabe.
CREATE TABLE trust.event_outcomes (
  event_id    uuid PRIMARY KEY,
  outcome     text NOT NULL CHECK (outcome IN ('PENDING','CONFIRMED','FALSE')),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Sanciones de moderación aplicadas por personas (no las reglas automáticas). Una apelación aceptada las revierte.
CREATE TABLE trust.sanctions (
  action_id    uuid PRIMARY KEY,
  user_id      uuid NOT NULL,
  action       text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  reversed_at  timestamptz
);
CREATE INDEX sanctions_user_idx ON trust.sanctions (user_id, created_at DESC);
