-- ADR 0173: fallos de la app autoalojados. Sin usuario ni IP: solo lo necesario para agrupar y corregir.
CREATE TABLE platform.client_crashes (
  id uuid PRIMARY KEY,
  fingerprint text NOT NULL,
  message text NOT NULL,
  location text,
  stack text,
  request_id text,
  platform text,
  app_version text,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX client_crashes_received_idx ON platform.client_crashes (received_at);
CREATE INDEX client_crashes_fingerprint_idx ON platform.client_crashes (fingerprint, received_at);
