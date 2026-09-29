-- ADR 0130: estado de las alertas operativas (SLO incumplido, outbox atascado) para avisar solo al cambiar.
CREATE SCHEMA IF NOT EXISTS quality;
CREATE TABLE quality.ops_alert_state (
  key         text PRIMARY KEY,
  breached    boolean NOT NULL,
  observed    double precision,
  changed_at  timestamptz NOT NULL DEFAULT now()
);
