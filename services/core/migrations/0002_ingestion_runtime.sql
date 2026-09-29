-- Dizaster · migración 0002 · estado de ejecución de la ingestión (carriles NORMAL/URGENT y circuit breaker)

CREATE TABLE ingestion.source_state (
  source_id             uuid PRIMARY KEY REFERENCES ingestion.sources(id),
  -- Validadores HTTP por carril: el sondeo URGENT no debe "consumir" los cambios que el carril NORMAL aún no procesó.
  etag_normal           text,
  last_modified_normal  text,
  etag_urgent           text,
  last_modified_urgent  text,
  last_normal_run_at    timestamptz,
  last_urgent_run_at    timestamptz,
  consecutive_failures  int NOT NULL DEFAULT 0,
  -- Circuit breaker: mientras open_until > now() no se consulta la fuente.
  open_until            timestamptz,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ingestion.runs (
  id           uuid PRIMARY KEY,
  source_id    uuid NOT NULL REFERENCES ingestion.sources(id),
  lane         text NOT NULL CHECK (lane IN ('NORMAL','URGENT')),
  started_at   timestamptz NOT NULL,
  finished_at  timestamptz,
  http_status  int,
  items_seen   int NOT NULL DEFAULT 0,
  items_new    int NOT NULL DEFAULT 0,
  items_urgent int NOT NULL DEFAULT 0,
  status       text NOT NULL CHECK (status IN ('RUNNING','OK','NOT_MODIFIED','FAILED','SKIPPED_CIRCUIT_OPEN')),
  error        text
);
CREATE INDEX runs_source_idx ON ingestion.runs (source_id, started_at DESC);
