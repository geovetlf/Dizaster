-- Pausa/reanudación de fuentes desde la app de administración, auditada (ADR 0162).
CREATE TABLE ingestion.source_status_log (
  id          uuid PRIMARY KEY,
  source_id   uuid NOT NULL REFERENCES ingestion.sources(id),
  from_status text NOT NULL,
  to_status   text NOT NULL,
  reason      text NOT NULL,
  actor       text NOT NULL,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX source_status_log_source_idx ON ingestion.source_status_log (source_id, at DESC);
